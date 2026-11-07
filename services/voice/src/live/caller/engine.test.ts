import type { Db } from "@bill-fighter/db/client";
import { approvals, calls } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWERS } from "../../facts.ts";
import { extractOutcome } from "../../outcome.ts";
import { checkPlan, lineKey } from "../../sim/engine.ts";
import { ALARM_LINES, SEED_PLAN, seedCallData, seedCallFacts } from "../../sim/fixture.ts";
import type { TranscriptRow } from "../../transcript.ts";
import { LINE_NUMBER } from "../line/script.ts";
import { CALLER_NUMBER } from "./agent.ts";
import { liveRowProblems, runLiveCall } from "./engine.ts";
import { endedCall, END_MS, fullCallItems, RECORDING_URL, RETELL_ID, said, START_MS, STUB_FACTS, stubRetell } from "./fixture.ts";

const ACTION = "call-action";
const spacedDigits = (number: string) => [...lineKey(number)].join(" ");

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("live_caller", async (db) => {
  await seedCallData(db, ACTION);
  await seedCallFacts(db, ACTION);
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
  vi.stubEnv("RETELL_CALLER_AGENT_VERSION", "0");
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

describe("the fact sheet and the approval", () => {
  test("sends the sheet from the database, with the approver and date, and no alarm line or contact details", async (db) => {
    const stub = stubRetell([await goodCall(db)]);
    await run(db, stub);
    const variables = (stub.dials()[0]!.body as { retell_llm_dynamic_variables: Record<string, string> }).retell_llm_dynamic_variables;
    expect(variables.authorized_answer).toBe("Yes. Linda Park, the account holder, approved these changes on November 7, 2026. I'm an AI assistant acting for Golden Gate Noodle Co.");
    expect(variables.fact_sheet).toContain("412 Clement St");
    const everything = Object.values(variables).join(" ");
    for (const alarm of ALARM_LINES) expect(everything).not.toContain(spacedDigits(alarm));
    expect(everything).not.toMatch(/linda@|555-0100/);
  });

  test("never dials if a process approved rather than the owner, and leaves no row", async (db) => {
    await db.update(approvals).set({ approvedBy: "run-local auto approval" });
    const stub = stubRetell([]);
    await expect(run(db, stub)).rejects.toThrow(/not from the account holder/);
    expect(stub.requests).toEqual([]);
    expect(await db.select().from(calls)).toEqual([]);
  });

  test("never dials with no approved bundle", async (db) => {
    await db.update(approvals).set({ status: "denied" });
    const stub = stubRetell([]);
    await expect(run(db, stub)).rejects.toThrow(/no approved bundle/);
    expect(stub.requests).toEqual([]);
  });
});

describe("items outside the approved plan", () => {
  const stray = (planned: Parameters<typeof fullCallItems>[1]) => {
    const items = fullCallItems(SEED_PLAN, planned);
    // A line the rep said yes to, which nobody approved, just before the read-back.
    const at = items.findIndex((item) => item.content?.startsWith("To confirm"));
    items.splice(at, 0, said("agent", `Please cancel phone line ${spacedDigits(ALARM_LINES[0]!)}.`), said("user", "Yes, that is cancelled."));
    return items;
  };

  test("a yes to an unapproved line fails the live call, keeping the row, even with a ticket", async (db) => {
    const { planned } = await checkPlan(db, SEED_PLAN);
    await expect(run(db, stubRetell([endedCall(stray(planned))]))).rejects.toThrow(/outside the approved plan: line/);
    const { rows } = await onlyRow(db);
    expect(rows.at(-1)!.content).toMatch(/^Live call failed: .*outside the approved plan/);
  });

  // The reply matches neither fixed yes, so extractOutcome drops both items: the check must not depend on it.
  test("a combined request and combined yes fails the call and the row check, though the outcome looks clean", async (db) => {
    const { planned } = await checkPlan(db, SEED_PLAN);
    const items = fullCallItems(SEED_PLAN, planned);
    const at = items.findIndex((item) => item.content?.startsWith("To confirm"));
    items.splice(at, 0, said("agent", `Please cancel phone line ${spacedDigits(ALARM_LINES[0]!)}, and restore promo pricing on B C, 9 9 9 9.`), said("user", "Yes, that is cancelled. Yes, promo pricing is restored."));
    await expect(run(db, stubRetell([endedCall(items)]))).rejects.toThrow(/outside the approved plan: line .*account BC-9999/);
    const { call, rows } = await onlyRow(db);
    const outcomeJson = extractOutcome(rows);
    expect(outcomeJson).toEqual({ cancelled_lines: SEED_PLAN.cancelLines.map(lineKey), credits: SEED_PLAN.promoAccounts, ticket: "BT-48213" });
    expect(liveRowProblems({ ...call, outcomeJson }, SEED_PLAN)).toEqual([`line ${lineKey(ALARM_LINES[0]!)} is outside the approved plan`, "account BC-9999 is outside the approved plan"]);
  });

  test("answers from the fact sheet are not mistaken for an item outside the plan", async (db) => {
    const { planned } = await checkPlan(db, SEED_PLAN);
    const items = fullCallItems(SEED_PLAN, planned);
    const at = items.findIndex((item) => item.content?.startsWith("To confirm"));
    items.splice(at, 0, said("user", "What was the last bill?"), said("agent", "B T, 7 0 0 1 at 412 Clement St, San Francisco, CA 94118: $1,234.56 for the period ending 2026-10-31, approved on November 7, 2026."));
    await expect(run(db, stubRetell([endedCall(items)]))).resolves.toHaveProperty("callId");
  });
});

describe("the rep's question", () => {
  test("a call where the rep asks a question mid-request still counts every item, once the request is repeated", async (db) => {
    const { planned } = await checkPlan(db, SEED_PLAN);
    const items = fullCallItems(SEED_PLAN, planned);
    const at = items.findIndex((item) => item.content?.startsWith("Please cancel"));
    const request = items[at]!.content!;
    const reply = items.slice(at + 1, at + 3);
    items.splice(at + 1, 2, said("user", "Are you authorized to do that?"), said("agent", `${ANSWERS.authorized(STUB_FACTS)} ${request}`), ...reply);
    await run(db, stubRetell([endedCall(items)]));
    const { rows } = await onlyRow(db);
    expect(extractOutcome(rows).cancelled_lines).toEqual(SEED_PLAN.cancelLines.map(lineKey));
    expect(rows.map((row) => row.content).join(" ")).toContain("on November 7, 2026.");
  });

  test("an answer between a request and its yes, with no repeat, leaves that item out", async (db) => {
    const { planned } = await checkPlan(db, SEED_PLAN);
    const items = fullCallItems(SEED_PLAN, planned);
    const at = items.findIndex((item) => item.content?.startsWith("Please cancel"));
    const reply = items.slice(at + 1, at + 3);
    items.splice(at + 1, 2, said("user", "Are you authorized to do that?"), said("agent", ANSWERS.authorized(STUB_FACTS)), ...reply);
    await run(db, stubRetell([endedCall(items)]));
    const { rows } = await onlyRow(db);
    expect(extractOutcome(rows).cancelled_lines).not.toContain(lineKey(SEED_PLAN.cancelLines[0]!));
    expect(extractOutcome(rows).cancelled_lines).toHaveLength(6);
  });
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

  test("reads the plain transcript if the tool one is empty", async (db) => {
    const call = await goodCall(db);
    const stub = stubRetell([{ ...call, transcript_with_tool_calls: [], transcript_object: call.transcript_with_tool_calls }]);
    await run(db, stub, { settleMs: 2000 });
    expect(extractOutcome((await onlyRow(db)).rows).ticket).toBe("BT-48213");
  });

  test("keeps waiting while the ended call's transcript is empty", async (db) => {
    const good = await goodCall(db);
    const stub = stubRetell([{ ...good, transcript_with_tool_calls: [] }, good]);
    await expect(run(db, stub, { settleMs: 2000 })).resolves.toHaveProperty("callId");
    expect(extractOutcome((await onlyRow(db)).rows).ticket).toBe("BT-48213");
    expect(stub.requests.filter((request) => request.path === `/v2/get-call/${RETELL_ID}`)).toHaveLength(3);
  });

  test("fails the call if the transcript is still empty when the wait runs out", async (db) => {
    const stub = stubRetell([await goodCall(db, { transcript_with_tool_calls: [] })]);
    await expect(run(db, stub, { settleMs: 20 })).rejects.toThrow("did not open with the disclosure");
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

describe("the agent id", () => {
  test("is read from the env when the call is placed", async (db) => {
    vi.stubEnv("RETELL_CALLER_AGENT_ID", "agent-from-env");
    const stub = stubRetell([await goodCall(db)]);
    await run(db, stub, { agentId: undefined });
    expect(stub.dials()[0]!.body).toMatchObject({ override_agent_id: "agent-from-env" });
  });

  test("dials the verified version from the env, read when the call is placed", async (db) => {
    vi.stubEnv("RETELL_CALLER_AGENT_VERSION", "7");
    const stub = stubRetell([await goodCall(db)]);
    await run(db, stub);
    expect(stub.dials()[0]!.body).toMatchObject({ override_agent_version: 7 });
  });
});

describe("when saving the Retell id fails", () => {
  const failFirstUpdate = (db: Db) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("database down");
    });
  };

  test("logs the id to stderr, and still polls and charges", async (db) => {
    const onCost = vi.fn();
    const stub = stubRetell([await goodCall(db)]);
    failFirstUpdate(db);
    await expect(run(db, stub, { onCost })).resolves.toHaveProperty("callId");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(RETELL_ID));
    expect(stub.requests.some((request) => request.path === `/v2/get-call/${RETELL_ID}`)).toBe(true);
    expect(onCost).toHaveBeenCalledOnce();
  });

  test("still stops and charges a call that never ends", async (db) => {
    const onCost = vi.fn();
    const stub = stubRetell([{ call_status: "ongoing" }]);
    failFirstUpdate(db);
    await expect(run(db, stub, { deadlineMs: 20, onCost })).rejects.toThrow("did not end in time");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(RETELL_ID));
    expect(stub.requests.at(-1)).toMatchObject({ method: "POST", path: `/v2/stop-call/${RETELL_ID}` });
    expect(onCost).toHaveBeenCalledOnce();
  });
});

describe("the deadline", () => {
  const DEADLINE_MS = 200;
  // Room for the database writes either side of the wait, and well short of any stalled request.
  const LIMIT_MS = DEADLINE_MS + 300;

  // Never answers, and ignores the abort too, as the worst case of a stalled connection.
  function stalling(stub: ReturnType<typeof stubRetell>, stalls: (path: string) => boolean) {
    const signals: AbortSignal[] = [];
    let dialedAt = 0;
    const fetchImpl: typeof fetch = (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v2/create-phone-call") dialedAt = Date.now();
      if (!stalls(path)) return stub.fetchImpl(input, init);
      signals.push(init!.signal!);
      return new Promise(() => {});
    };
    return { fetchImpl, signals, elapsed: () => Date.now() - dialedAt };
  }

  test("holds against a stalled poll, and the call is still stopped and charged", async (db) => {
    const stub = stubRetell([]);
    const stall = stalling(stub, (path) => path.startsWith("/v2/get-call/"));
    let elapsed = Infinity;
    await expect(run(db, stall, { deadlineMs: DEADLINE_MS, onCost: () => (elapsed = stall.elapsed()) })).rejects.toThrow("did not end in time");
    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(stall.signals.length).toBeGreaterThan(0);
    expect(stall.signals.every((signal) => signal.aborted)).toBe(true);
    expect(stub.requests.at(-1)).toMatchObject({ method: "POST", path: `/v2/stop-call/${RETELL_ID}` });
    const { call, rows } = await onlyRow(db);
    expect(call.endedAt).toBeInstanceOf(Date);
    expect(rows.at(-1)!.content).toContain("did not end in time");
  });

  test("holds against a stalled stop, and the row is still closed and the fallback reached", async (db) => {
    const onCost = vi.fn();
    const stall = stalling(stubRetell([{ call_status: "ongoing" }]), (path) => path.startsWith("/v2/stop-call/"));
    let elapsed = Infinity;
    await expect(
      run(db, stall, {
        deadlineMs: DEADLINE_MS,
        onCost: (usd) => {
          elapsed = stall.elapsed();
          onCost(usd);
        },
      }),
    ).rejects.toThrow("did not end in time");
    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(stall.signals).toHaveLength(1);
    expect(stall.signals[0]!.aborted).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`Stopping Retell call ${RETELL_ID} failed`));
    expect(onCost).toHaveBeenCalledOnce();
    expect((await onlyRow(db)).call.endedAt).toBeInstanceOf(Date);
  });

  test("holds against a stalled read while settling, and keeps what the call had", async (db) => {
    const stub = stubRetell([await goodCall(db, { recording_url: undefined })]);
    let reads = 0;
    const stall = stalling(stub, (path) => path.startsWith("/v2/get-call/") && ++reads > 2);
    let elapsed = Infinity;
    await run(db, stall, { deadlineMs: DEADLINE_MS, settleMs: 60_000, onCost: () => (elapsed = stall.elapsed()) });
    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect((await onlyRow(db)).call.recordingUrl).toBeNull();
  });

  test("holds with a poll gap longer than the deadline", async (db) => {
    const stub = stubRetell([]);
    const stall = stalling(stub, () => false);
    let elapsed = Infinity;
    await expect(run(db, stall, { deadlineMs: DEADLINE_MS, pollMs: 60_000, onCost: () => (elapsed = stall.elapsed()) })).rejects.toThrow("did not end in time");
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });
});

describe("liveRowProblems", () => {
  const lines = SEED_PLAN.cancelLines.map(lineKey);
  const good = { mode: "live", recordingUrl: RECORDING_URL, transcriptJson: [], outcomeJson: { cancelled_lines: lines, credits: SEED_PLAN.promoAccounts, ticket: "BT-48213" } };
  const outcome = good.outcomeJson;

  it("checks seven lines and three accounts", () => {
    expect(lines).toHaveLength(7);
    expect(SEED_PLAN.promoAccounts).toHaveLength(3);
  });

  test("passes a full call saved the way call_provider saves it", async (db) => {
    await run(db, stubRetell([await goodCall(db)]));
    const { call, rows } = await onlyRow(db);
    expect(liveRowProblems({ ...call, outcomeJson: extractOutcome(rows) }, SEED_PLAN)).toEqual([]);
  });

  it("fails a disclosure and ticket with nothing confirmed, which the engine accepts", () => {
    const problems = liveRowProblems({ ...good, outcomeJson: { cancelled_lines: [], credits: [], ticket: "BT-48213" } }, SEED_PLAN);
    expect(problems).toHaveLength(10);
  });

  it.each([
    ["no row", undefined, "no live row"],
    ["a sim row", { ...good, mode: "sim" }, "no live row"],
    ["no saved outcome", { ...good, outcomeJson: null }, "no saved outcome"],
    ["one line short", { ...good, outcomeJson: { ...outcome, cancelled_lines: lines.slice(1) } }, `line ${lines[0]}`],
    ["one account short", { ...good, outcomeJson: { ...outcome, credits: SEED_PLAN.promoAccounts.slice(1) } }, `promo account ${SEED_PLAN.promoAccounts[0]}`],
    ["no ticket", { ...good, outcomeJson: { ...outcome, ticket: null } }, "the ticket is null"],
    ["a misheard ticket", { ...good, outcomeJson: { ...outcome, ticket: "BT-48214" } }, "the ticket is BT-48214"],
    ["no recording", { ...good, recordingUrl: null }, "no recording URL"],
  ])("fails %s", (_, row, expected) => {
    expect(liveRowProblems(row, SEED_PLAN)).toEqual([expect.stringContaining(expected)]);
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

  const unknownDial = (name: string, answer: () => Promise<Response>, message: string) =>
    test(`is the worst case at the cap, with no second dial, after ${name}`, async (db) => {
      const onCost = vi.fn();
      const fetchImpl = vi.fn<typeof fetch>(answer);
      await expect(run(db, { fetchImpl }, { onCost })).rejects.toThrow(message);
      await expect(run(db, { fetchImpl }, { onCost })).rejects.toThrow("will not dial again");
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(onCost).toHaveBeenCalledOnce();
      expect(onCost.mock.calls[0]![0]).toBeCloseTo(5 * 0.0882 + 0.0208 + 5 * 0.07);
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/dial outcome unknown.*300\.0 s.*\(estimate\)/));
    });

  unknownDial("a dial that timed out", () => Promise.reject(new DOMException("timed out", "TimeoutError")), "timed out");
  unknownDial("a dropped connection", () => Promise.reject(new TypeError("fetch failed")), "fetch failed");
  unknownDial("a server error", async () => new Response("oops", { status: 500 }), "HTTP 500");
  unknownDial("an answer with no call id", async () => Response.json({}), "no call id");

  test("is nothing for a dial Retell refused", async (db) => {
    const onCost = vi.fn();
    await expect(run(db, stubRetell([], { dialStatus: 402 }), { onCost })).rejects.toThrow("HTTP 402");
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
  refused("with no agent version", { RETELL_CALLER_AGENT_VERSION: "" }, "RETELL_CALLER_AGENT_VERSION");
  refused("with an agent version that is not a number", { RETELL_CALLER_AGENT_VERSION: "latest" }, "RETELL_CALLER_AGENT_VERSION");
  refused("with an alarm line in the plan", {}, "alarm line", { plan: { ...SEED_PLAN, cancelLines: [ALARM_LINES[0]!] } });
  refused("with a line not on file", {}, "not on file", { plan: { ...SEED_PLAN, cancelLines: ["+15550009999"] } });

  test("with no agent id in the env, which is what the real wiring reads", async (db) => {
    vi.stubEnv("RETELL_CALLER_AGENT_ID", "");
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
