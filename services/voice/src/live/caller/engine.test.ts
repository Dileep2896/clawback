import type { Db } from "@bill-fighter/db/client";
import { calls } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractOutcome } from "../../outcome.ts";
import { checkPlan, lineKey } from "../../sim/engine.ts";
import { ALARM_LINES, SEED_PLAN, seedCallData } from "../../sim/fixture.ts";
import type { TranscriptRow } from "../../transcript.ts";
import { LINE_NUMBER } from "../line/script.ts";
import { CALLER_NUMBER } from "./agent.ts";
import { runLiveCall } from "./engine.ts";
import { endedCall, END_MS, fullCallItems, RECORDING_URL, RETELL_ID, said, START_MS, stubRetell } from "./fixture.ts";

const ACTION = "call-action";

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("live_caller", async (db) => {
  await seedCallData(db, ACTION);
  await fn(db);
}));

const goodCall = async (db: Db, overrides: Record<string, unknown> = {}) => {
  const { planned } = await checkPlan(db, SEED_PLAN);
  return endedCall(fullCallItems(SEED_PLAN, planned), overrides);
};

function run(db: Db, stub: { fetchImpl: typeof fetch }, options: Partial<Parameters<typeof runLiveCall>[0]> = {}) {
  return runLiveCall({ db, actionId: ACTION, plan: SEED_PLAN, onCost: () => {}, fetchImpl: stub.fetchImpl, agentId: "agent", pollMs: 0, settleMs: 0, deadlineMs: 2000, ...options });
}

const onlyRow = async (db: Db) => {
  const rows = await db.select().from(calls);
  expect(rows).toHaveLength(1);
  return { call: rows[0]!, rows: rows[0]!.transcriptJson as TranscriptRow[] };
};

beforeEach(() => {
  vi.stubEnv("ALLOWED_CALL_NUMBERS", LINE_NUMBER);
  vi.stubEnv("VOICE_PROVIDER", "retell");
  vi.stubEnv("RETELL_API_KEY", "stub-key");
  // Nothing in this file may reach the network: every request must go through a stub.
  vi.stubGlobal("fetch", () => {
    throw new Error("A test tried to use the real network");
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a good call", () => {
  test("saves a live row whose outcome has every item and the ticket", async (db) => {
    const stub = stubRetell([await goodCall(db)]);
    const { callId } = await run(db, stub);
    const { call, rows } = await onlyRow(db);
    expect(call).toMatchObject({ id: callId, actionId: ACTION, mode: "live", toNumber: LINE_NUMBER, recordingUrl: RECORDING_URL, outcomeJson: null });
    expect(call.startedAt).toEqual(new Date(START_MS));
    expect(call.endedAt).toEqual(new Date(END_MS));
    expect(extractOutcome(rows)).toEqual({ cancelled_lines: SEED_PLAN.cancelLines.map(lineKey), credits: SEED_PLAN.promoAccounts, ticket: "BT-48213" });
  });

  test("has the exact disclosure as its first row, from Retell's record", async (db) => {
    await run(db, stubRetell([await goodCall(db)]));
    const { rows } = await onlyRow(db);
    expect(rows[0]).toMatchObject({ role: "agent", kind: "speech", content: DISCLOSURE_LINE });
  });

  test("shows the key press, and a last row naming the Retell call", async (db) => {
    await run(db, stubRetell([await goodCall(db)]));
    const { rows } = await onlyRow(db);
    expect(rows.filter((row) => row.kind === "keypress")).toMatchObject([{ role: "agent", content: "2" }]);
    expect(rows.at(-1)).toMatchObject({ role: "system", kind: "status", content: `Retell call ${RETELL_ID} ended: user_hangup.` });
  });

  test("dials the line from our number, once, with only the checked plan", async (db) => {
    const stub = stubRetell([await goodCall(db)]);
    await run(db, stub);
    expect(stub.dials()).toHaveLength(1);
    const body = stub.dials()[0]!.body as { from_number: string; to_number: string; override_agent_id: string; retell_llm_dynamic_variables: { requests: string } };
    expect(body).toMatchObject({ from_number: CALLER_NUMBER, to_number: LINE_NUMBER, override_agent_id: "agent", metadata: { actionId: ACTION } });
    expect(body.retell_llm_dynamic_variables.requests.split("\n")).toHaveLength(10);
  });

  test("shows only an in-progress row during the call", async (db) => {
    let during: TranscriptRow[] = [];
    let endedDuring: Date | null = new Date();
    const stub = stubRetell([await goodCall(db)], {
      onOngoing: async () => {
        const { call, rows } = await onlyRow(db);
        during = rows;
        endedDuring = call.endedAt;
      },
    });
    await run(db, stub);
    expect(endedDuring).toBeNull();
    expect(during.map((row) => row.kind)).toEqual(["status", "status"]);
    expect(during.at(-1)!.content).toBe(`Live call in progress. Retell call ${RETELL_ID}.`);
  });

  test("user_hangup is a normal ending and does not fail the call", async (db) => {
    await expect(run(db, stubRetell([await goodCall(db, { disconnection_reason: "user_hangup" })]))).resolves.toHaveProperty("callId");
  });

  test("agent_hangup is a normal ending too", async (db) => {
    await expect(run(db, stubRetell([await goodCall(db, { disconnection_reason: "agent_hangup" })]))).resolves.toHaveProperty("callId");
  });

  test("reads the plain transcript if the tool one is missing", async (db) => {
    const call = await goodCall(db);
    await run(db, stubRetell([{ ...call, transcript_with_tool_calls: undefined, transcript_object: call.transcript_with_tool_calls }]));
    expect(extractOutcome((await onlyRow(db)).rows).ticket).toBe("BT-48213");
  });

  test("waits for a late recording and cost after the call ends", async (db) => {
    const good = await goodCall(db);
    const onCost = vi.fn();
    await run(db, stubRetell([{ ...good, recording_url: undefined, call_cost: undefined }, good]), { settleMs: 2000, onCost });
    expect((await onlyRow(db)).call.recordingUrl).toBe(RECORDING_URL);
    expect(onCost.mock.calls[0]![0]).toBeCloseTo(0.29 + 3 * 0.07);
  });

  test("survives a bad read while the call runs", async (db) => {
    const stub = stubRetell([new Response("busy", { status: 503 }), await goodCall(db)]);
    await expect(run(db, stub)).resolves.toHaveProperty("callId");
  });
});

describe("cost", () => {
  test("goes to the budget once, as Retell's figure plus the Vapi estimate, and is logged", async (db) => {
    const onCost = vi.fn();
    await run(db, stubRetell([await goodCall(db)]), { onCost });
    expect(onCost).toHaveBeenCalledOnce();
    expect(onCost.mock.calls[0]![0]).toBeCloseTo(0.29 + 3 * 0.07);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${RETELL_ID}: 180.0 s, Retell \\$0.2900, Vapi about \\$0.2100`)));
  });

  test("is estimated, and says so, when Retell gives no figure", async (db) => {
    const onCost = vi.fn();
    await run(db, stubRetell([await goodCall(db, { call_cost: undefined })]), { onCost });
    expect(onCost.mock.calls[0]![0]).toBeCloseTo(3 * 0.0882 + 0.0208 + 3 * 0.07);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("(estimate)"));
  });

  test("is still charged when the call fails after it connected", async (db) => {
    const onCost = vi.fn();
    await expect(run(db, stubRetell([endedCall([said("agent", DISCLOSURE_LINE)])]), { onCost })).rejects.toThrow("no ticket");
    expect(onCost).toHaveBeenCalledOnce();
  });

  test("is nothing for a call that never connected", async (db) => {
    const onCost = vi.fn();
    await expect(run(db, stubRetell([{ call_status: "not_connected", disconnection_reason: "dial_failed" }]), { onCost })).rejects.toThrow();
    expect(onCost).not.toHaveBeenCalled();
  });
});

describe("never dials", () => {
  const refused = (name: string, env: Record<string, string>, message: string, options: Partial<Parameters<typeof runLiveCall>[0]> = {}) =>
    test(name, async (db) => {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      const stub = stubRetell([]);
      await expect(run(db, stub, options)).rejects.toThrow(message);
      expect(stub.requests).toEqual([]);
      expect(await db.select().from(calls)).toEqual([]);
    });

  refused("with another number on the allowlist", { ALLOWED_CALL_NUMBERS: "+15550003333" }, "must hold only");
  refused("with a second number on the allowlist", { ALLOWED_CALL_NUMBERS: `${LINE_NUMBER},+15550003333` }, "must hold only");
  refused("with an empty allowlist", { ALLOWED_CALL_NUMBERS: "" }, "must hold only");
  refused("with another provider", { VOICE_PROVIDER: "vapi" }, "only retell is built");
  refused("with no provider", { VOICE_PROVIDER: "" }, "only retell is built");
  refused("with no key", { RETELL_API_KEY: "" }, "RETELL_API_KEY");
  refused("before the caller is provisioned", {}, "not provisioned", { agentId: "" });
  refused("with an alarm line in the plan", {}, "alarm line", { plan: { ...SEED_PLAN, cancelLines: [ALARM_LINES[0]!] } });
  refused("with a line not on file", {}, "not on file", { plan: { ...SEED_PLAN, cancelLines: ["+15550009999"] } });

  test("the default agent id is what the real wiring uses, and it refuses until provision fills it", async (db) => {
    const stub = stubRetell([]);
    await expect(runLiveCall({ db, actionId: ACTION, plan: SEED_PLAN, onCost: () => {}, fetchImpl: stub.fetchImpl })).rejects.toThrow("not provisioned");
    expect(stub.requests).toEqual([]);
  });

  test("a second time for an action, so a retry can never pay for another call", async (db) => {
    const stub = stubRetell([], { dialStatus: 500 });
    await expect(run(db, stub)).rejects.toThrow("HTTP 500");
    await expect(run(db, stub)).rejects.toThrow("will not dial again");
    expect(stub.dials()).toHaveLength(1);
  });

  test("again after a call that ended well", async (db) => {
    const stub = stubRetell([await goodCall(db)]);
    await run(db, stub);
    await expect(run(db, stub)).rejects.toThrow("will not dial again");
    expect(stub.dials()).toHaveLength(1);
  });
});

describe("a failed call throws and keeps a marked partial row", () => {
  const failed = (name: string, reading: (db: Db) => Promise<unknown>, message: string) =>
    test(name, async (db) => {
      await expect(run(db, stubRetell([await reading(db)]))).rejects.toThrow(message);
      const { call, rows } = await onlyRow(db);
      expect(call).toMatchObject({ mode: "live", outcomeJson: null });
      expect(call.endedAt).toBeInstanceOf(Date);
      expect(rows.at(-1)).toMatchObject({ kind: "status", content: expect.stringContaining("Live call failed") });
    });

  failed("not connected", async () => ({ call_status: "not_connected", disconnection_reason: "dial_no_answer" }), "dial_no_answer");
  failed("an error status", async () => ({ call_status: "error", disconnection_reason: "credit_exhausted" }), "credit_exhausted");
  failed("no ticket", async () => endedCall([said("agent", DISCLOSURE_LINE), said("user", "Goodbye.")]), "no ticket");
  failed("no ticket after running out of time", async () => endedCall([said("agent", DISCLOSURE_LINE)], { disconnection_reason: "max_duration_reached" }), "max_duration_reached");
  failed("no transcript at all", async () => endedCall([], { transcript_with_tool_calls: undefined }), "disclosure");
  failed("a reworded disclosure", async () => endedCall([said("agent", "Hello, I am a robot."), said("user", "Your ticket number is B, T, 4.")]), "disclosure");
  failed("the provider speaking first", async () => endedCall([said("user", "Your ticket number is B, T, 4.")]), "disclosure");
  failed("a disclosure that runs into another word", async () => endedCall([said("agent", `${DISCLOSURE_LINE}ly`), said("user", "Your ticket number is B, T, 4.")]), "disclosure");

  test("keeps what was said on a partial call", async (db) => {
    await expect(run(db, stubRetell([endedCall([said("agent", DISCLOSURE_LINE), said("user", "For billing, press two.")])]))).rejects.toThrow("no ticket");
    const { call, rows } = await onlyRow(db);
    expect(call.recordingUrl).toBe(RECORDING_URL);
    expect(rows.map((row) => row.content)).toEqual([DISCLOSURE_LINE, "For billing, press 2.", `Retell call ${RETELL_ID} ended: user_hangup.`, expect.stringContaining("Live call failed")]);
  });

  test("a refused dial leaves the row closed, with the reason", async (db) => {
    await expect(run(db, stubRetell([], { dialStatus: 402 }))).rejects.toThrow("HTTP 402");
    const { call, rows } = await onlyRow(db);
    expect(call.endedAt).toBeInstanceOf(Date);
    expect(rows.at(-1)!.content).toContain("HTTP 402");
  });

  test("a call that never ends is stopped, and charged at the cap to stay on the safe side", async (db) => {
    const onCost = vi.fn();
    const stub = stubRetell([{ call_status: "ongoing" }]);
    await expect(run(db, stub, { deadlineMs: 20, onCost })).rejects.toThrow("did not end in time");
    expect(stub.requests.at(-1)).toMatchObject({ method: "POST", path: `/v2/stop-call/${RETELL_ID}` });
    expect(onCost.mock.calls[0]![0]).toBeCloseTo(5 * 0.0882 + 0.0208 + 5 * 0.07);
  });
});
