import type { Db } from "@bill-fighter/db/client";
import { accounts, actions, calls, findings, phoneLines } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { createCanUseTool } from "@bill-fighter/platform/local/agent-runtime";
import { createApprovalGate } from "@bill-fighter/platform/local/approval-gate";
import type { Audit, Budget, Llm } from "@bill-fighter/platform/types";
import type { Allowlist } from "@bill-fighter/shared/allowlist";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { runLiveCall } from "@bill-fighter/voice/live/caller/engine";
import { endedCall, fullCallItems, said, stubRetell } from "@bill-fighter/voice/live/caller/fixture";
import { LINE_NUMBER } from "@bill-fighter/voice/live/line/script";
import { checkPlan, lineKey, runSimCall } from "@bill-fighter/voice/sim/engine";
import { ALARM_LINES, SEED_PLAN, seedCallData, seedCallFacts } from "@bill-fighter/voice/sim/fixture";
import { stubLlm } from "@bill-fighter/voice/sim/stub-llm";
import type { TranscriptRow } from "@bill-fighter/voice/transcript";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTools } from "../registry.ts";
import { wrapTool } from "../tool-wrapper.ts";
import { negotiatorTools, type NegotiatorDeps } from "./negotiator.ts";

const CALL = "call-action";
const CTX = { runId: "run-1", agent: "negotiator" };
const ALLOWED: Allowlist = { callNumbers: [LINE_NUMBER], emailDomains: [], portalOrigins: [] };
const LINE = SEED_PLAN.cancelLines[0]!;
const PROMO = SEED_PLAN.promoAccounts[0]!;
const STATUS = { totalUsd: 0, capUsd: 5, over: false };

const seeded = (name: string, fn: (db: Db) => Promise<void>, approved: boolean) =>
  it(name, () =>
    withTestDb("negotiator_tool", async (db) => {
      await seedCallData(db, CALL);
      await db.update(actions).set({ payloadJson: SEED_PLAN }).where(eq(actions.id, CALL));
      if (approved) await seedCallFacts(db, CALL);
      await fn(db);
    }),
  );
const test = (name: string, fn: (db: Db) => Promise<void>) => seeded(name, fn, true);
// For the gate's own tests, which make their own bundles.
const unapproved = (name: string, fn: (db: Db) => Promise<void>) => seeded(name, fn, false);

// One finding and one cancel action for a line, the shape tools-file-approve creates.
async function seedCancel(db: Db, number: string, id: string) {
  const [line] = await db.select().from(phoneLines).where(eq(phoneLines.number, number));
  await db.insert(findings).values({
    id,
    customerId: CUSTOMER.id,
    accountId: line!.accountId,
    type: "unusedLines",
    title: number,
    explanation: number,
    evidenceJson: { billIds: [], billLineIds: [], phoneLineIds: [line!.id], detail: {} },
    confidence: 0.9,
  });
  await db.insert(actions).values({ id, findingId: id, kind: "cancel", status: "approved" });
  return id;
}

async function seedPromo(db: Db, accountNumber: string, id: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber));
  await db.insert(findings).values({
    id,
    customerId: CUSTOMER.id,
    accountId: account!.id,
    type: "promoExpiry",
    title: accountNumber,
    explanation: accountNumber,
    evidenceJson: { billIds: ["b"], billLineIds: [], phoneLineIds: [], detail: {} },
    confidence: 0.8,
  });
  return id;
}

const statusOf = async (db: Db, id: string) => (await db.select().from(findings).where(eq(findings.id, id)))[0]?.status;
const actionStatus = async (db: Db, id: string) => (await db.select().from(actions).where(eq(actions.id, id)))[0]?.status;

type CallResult = {
  callId: string;
  mode: string;
  fallbackReason?: string;
  repeated?: boolean;
  outcome: { cancelled_lines: string[]; credits: string[]; ticket: string | null };
};

function setup(db: Db, options: { refuse?: string[]; llm?: Llm; live?: NegotiatorDeps["live"]; allowlist?: Allowlist; budget?: Budget } = {}) {
  const llm = options.llm ?? stubLlm().llm;
  const sim = vi.fn<NegotiatorDeps["sim"]>((call) => runSimCall({ db, llm, ...call, ...(options.refuse ? { refuse: options.refuse } : {}) }));
  const live = vi.fn<NegotiatorDeps["live"]>(
    options.live ??
      (async () => {
        throw new Error("live line down");
      }),
  );
  const record = vi.fn<Audit["record"]>(async () => {});
  const budget: Budget = options.budget ?? { add: async () => STATUS, status: async () => STATUS };
  const tools = negotiatorTools({ db, budget: async () => budget, sim, live });
  const wrap = (name: string) =>
    wrapTool(tools.find((tool) => tool.name === name)!, { audit: { record, list: async () => [] }, allowlist: options.allowlist ?? ALLOWED });
  return {
    sim,
    live,
    record,
    call: (actionId = CALL) => wrap("call_provider").handler({ actionId }, CTX) as Promise<CallResult>,
    cancel: (actionId: string, callId: string) => wrap("cancel_service").handler({ actionId, callId }, CTX),
  };
}

beforeEach(() => vi.stubEnv("VOICE_MODE", "sim"));
afterEach(() => vi.unstubAllEnvs());

describe("approval", () => {
  const sdk = { name: "platform", source: "sdk" };
  const options = (toolUseID: string) => ({ signal: new AbortController().signal, toolUseID, requestId: "r", mcpServer: sdk }) as never;

  async function decisions(db: Db) {
    const gate = createApprovalGate(db);
    const canUse = createCanUseTool(await loadTools(), gate, () => {});
    return {
      gate,
      callTool: (input: Record<string, unknown> = { actionId: CALL }) => canUse("mcp__platform__call_provider", input, options("t1")),
      cancelTool: () => canUse("mcp__platform__cancel_service", { actionId: CALL, callId: "c" }, options("t2")),
    };
  }

  unapproved("both tools are blocked with no bundle, and without an actionId", async (db) => {
    const { callTool, cancelTool } = await decisions(db);
    expect(await callTool()).toMatchObject({ behavior: "deny" });
    expect(await cancelTool()).toMatchObject({ behavior: "deny" });
    expect(await callTool({})).toMatchObject({ behavior: "deny" });
  });

  unapproved("a denied bundle blocks both tools", async (db) => {
    await seedRun(db, "run-1");
    const { gate, callTool, cancelTool } = await decisions(db);
    await gate.createBundle({ runId: "run-1", actionIds: [CALL], summary: "s" });
    await gate.decide({ runId: "run-1", status: "denied", channel: "dashboard", approvedBy: "owner" });
    expect(await callTool()).toMatchObject({ behavior: "deny" });
    expect(await cancelTool()).toMatchObject({ behavior: "deny" });
  });

  unapproved("one approval releases both tools with no second decision", async (db) => {
    await seedRun(db, "run-1");
    const { gate, callTool, cancelTool } = await decisions(db);
    await gate.createBundle({ runId: "run-1", actionIds: [CALL], summary: "s" });
    await gate.decide({ runId: "run-1", status: "approved", channel: "dashboard", approvedBy: "owner" });
    expect(await callTool()).toMatchObject({ behavior: "allow" });
    expect(await cancelTool()).toMatchObject({ behavior: "allow" });
  });
});

describe("call_provider", () => {
  test("a number not on the allowlist is refused before any call starts", async (db) => {
    const { call, sim, live, record } = setup(db, { allowlist: { ...ALLOWED, callNumbers: ["+15550003333"] } });
    await expect(call()).rejects.toThrow("not on the allowlist");
    expect(sim).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
    expect(await db.select().from(calls)).toEqual([]);
    expect(record.mock.calls[0]?.[0]).toMatchObject({ tool: "call_provider", output: { refused: expect.any(String) } });
  });

  test("an empty allowlist refuses too, so a fresh copy never dials", async (db) => {
    const { call, sim } = setup(db, { allowlist: { ...ALLOWED, callNumbers: [] } });
    await expect(call()).rejects.toThrow("not on the allowlist");
    expect(sim).not.toHaveBeenCalled();
  });

  test("a full call saves the outcome, and marks the action done and the promo won", async (db) => {
    await seedPromo(db, PROMO, "promo");
    const result = await setup(db).call();
    expect(result.outcome.cancelled_lines).toEqual(SEED_PLAN.cancelLines.map(lineKey));
    expect(result.outcome.credits).toEqual(SEED_PLAN.promoAccounts);
    expect(result.outcome.ticket).toBe("BT-48213");
    const [row] = await db.select().from(calls).where(eq(calls.id, result.callId));
    expect(row).toMatchObject({ mode: "sim", toNumber: LINE_NUMBER, outcomeJson: result.outcome });
    expect(await actionStatus(db, CALL)).toBe("done");
    expect(await statusOf(db, "promo")).toBe("won");
  });

  test("a refused line and promo stay out of the outcome, and their findings stay unwon", async (db) => {
    await seedPromo(db, PROMO, "refused-promo");
    await seedPromo(db, SEED_PLAN.promoAccounts[1]!, "won-promo");
    const refusedLine = await seedCancel(db, LINE, "refused-line");
    const wonLine = await seedCancel(db, SEED_PLAN.cancelLines[1]!, "won-line");
    const { call, cancel } = setup(db, { refuse: [LINE, PROMO] });

    const { callId, outcome } = await call();
    expect(outcome.cancelled_lines).not.toContain(lineKey(LINE));
    expect(outcome.cancelled_lines).toHaveLength(6);
    expect(outcome.credits).not.toContain(PROMO);
    expect(outcome.credits).toHaveLength(2);
    expect(await statusOf(db, "refused-promo")).toBe("proposed");
    expect(await statusOf(db, "won-promo")).toBe("won");

    await expect(cancel(refusedLine, callId)).rejects.toThrow("does not confirm");
    await cancel(wonLine, callId);
    expect(await statusOf(db, refusedLine)).toBe("proposed");
    expect(await actionStatus(db, refusedLine)).toBe("approved");
    expect(await statusOf(db, wonLine)).toBe("won");
  });

  test("a retry returns the finished call and does not call again", async (db) => {
    const { call, sim } = setup(db);
    const first = await call();
    const second = await call();
    expect(second).toMatchObject({ callId: first.callId, repeated: true, outcome: first.outcome });
    expect(sim).toHaveBeenCalledOnce();
    expect(await db.select().from(calls)).toHaveLength(1);
  });

  test("two overlapping uses for one action start the engine once and return the same outcome", async (db) => {
    const { call, sim } = setup(db);
    const [first, second] = await Promise.all([call(), call()]);
    expect(sim).toHaveBeenCalledOnce();
    expect(second).toEqual(first);
    expect(await db.select().from(calls)).toHaveLength(1);
  });

  test("a failed call leaves no outcome and wins nothing, and can be tried again", async (db) => {
    await seedPromo(db, PROMO, "promo");
    const { llm } = stubLlm({ rep: () => ({ lines: [], endCall: false }) });
    await expect(setup(db, { llm }).call()).rejects.toThrow("said nothing");
    const [row] = await db.select().from(calls);
    expect(row!.outcomeJson).toBeNull();
    expect(await actionStatus(db, CALL)).toBe("approved");
    expect(await statusOf(db, "promo")).toBe("proposed");
    expect((await setup(db).call()).outcome.ticket).toBe("BT-48213");
  });

  test("an action of another kind, or an unknown one, places no call", async (db) => {
    await db.insert(actions).values({ id: "pay", kind: "card_pay", status: "approved", payloadJson: SEED_PLAN });
    const { call, sim } = setup(db);
    await expect(call("pay")).rejects.toThrow("not one");
    await expect(call("missing")).rejects.toThrow("not one");
    expect(sim).not.toHaveBeenCalled();
  });

  test("an invalid plan places no call", async (db) => {
    await db.update(actions).set({ payloadJson: { cancelLines: "all" } }).where(eq(actions.id, CALL));
    const { call, sim } = setup(db);
    await expect(call()).rejects.toThrow();
    expect(sim).not.toHaveBeenCalled();
  });

  test("a plan holding an alarm line places no call", async (db) => {
    await db.update(actions).set({ payloadJson: { ...SEED_PLAN, cancelLines: [ALARM_LINES[0]!] } }).where(eq(actions.id, CALL));
    await expect(setup(db).call()).rejects.toThrow(/alarm/);
    expect(await db.select().from(calls)).toEqual([]);
  });

  test("the cost of a call goes to the budget once, also when it fails", async (db) => {
    const add = vi.fn<Budget["add"]>(async () => STATUS);
    const { llm: inner } = stubLlm({ rep: () => ({ lines: [], endCall: false }) });
    const llm: Llm = {
      structured(input, schema) {
        input.onCost?.(0.25);
        return inner.structured(input, schema);
      },
    };
    await expect(setup(db, { llm, budget: { add, status: async () => STATUS } }).call()).rejects.toThrow("said nothing");
    expect(add.mock.calls).toEqual([[CTX.runId, 0.25]]);
  });
});

describe("VOICE_MODE", () => {
  test("sim never touches the live engine", async (db) => {
    const { call, live } = setup(db);
    expect((await call()).mode).toBe("sim");
    expect(live).not.toHaveBeenCalled();
  });

  test("unset means sim", async (db) => {
    vi.stubEnv("VOICE_MODE", "");
    const { call, live } = setup(db);
    expect((await call()).mode).toBe("sim");
    expect(live).not.toHaveBeenCalled();
  });

  test("live uses the live engine and does not start a sim", async (db) => {
    vi.stubEnv("VOICE_MODE", "live");
    const live: NegotiatorDeps["live"] = async ({ actionId }) => {
      const [row] = await db.insert(calls).values({ actionId, mode: "live", toNumber: LINE_NUMBER, transcriptJson: [] }).returning();
      return { callId: row!.id };
    };
    const { call, sim } = setup(db, { live });
    expect(await call()).toMatchObject({ mode: "live" });
    expect(sim).not.toHaveBeenCalled();
    expect((await db.select().from(calls))[0]!.mode).toBe("live");
  });

  test("a failed live call falls back to sim, labelled on the row the screen reads", async (db) => {
    vi.stubEnv("VOICE_MODE", "live");
    const { call, live, sim } = setup(db);
    const result = await call();
    expect(live).toHaveBeenCalledOnce();
    expect(sim).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ mode: "sim", fallbackReason: "live line down" });
    const [row] = await db.select().from(calls).where(eq(calls.id, result.callId));
    const rows = row!.transcriptJson as TranscriptRow[];
    expect(row!.mode).toBe("sim");
    expect(rows[1]).toMatchObject({ role: "system", kind: "fallback", content: expect.stringContaining("live line down") });
    expect(result.outcome.ticket).toBe("BT-48213");
  });

  test("an unknown value places no call of either kind", async (db) => {
    vi.stubEnv("VOICE_MODE", "lvie");
    const { call, live, sim } = setup(db);
    await expect(call()).rejects.toThrow('Unknown VOICE_MODE "lvie"');
    expect(live).not.toHaveBeenCalled();
    expect(sim).not.toHaveBeenCalled();
  });
});

describe("the live engine behind call_provider, on a stubbed Retell", () => {
  const liveWith = (db: Db, stub: ReturnType<typeof stubRetell>, options: { agentId?: string } = { agentId: "agent" }): NegotiatorDeps["live"] => (call) =>
    runLiveCall({ db, ...call, fetchImpl: stub.fetchImpl, pollMs: 0, settleMs: 0, deadlineMs: 2000, ...options });

  const goodCall = async (db: Db) => endedCall(fullCallItems(SEED_PLAN, (await checkPlan(db, SEED_PLAN)).planned));

  beforeEach(() => {
    vi.stubEnv("VOICE_MODE", "live");
    vi.stubEnv("VOICE_PROVIDER", "retell");
    vi.stubEnv("RETELL_API_KEY", "stub-key");
    vi.stubEnv("RETELL_CALLER_AGENT_VERSION", "0");
    vi.stubEnv("ALLOWED_CALL_NUMBERS", LINE_NUMBER);
    vi.stubGlobal("fetch", () => {
      throw new Error("A test tried to use the real network");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("a full call saves the ticket and every item, with mode live, and wins the findings", async (db) => {
    await seedPromo(db, PROMO, "promo");
    const line = await seedCancel(db, LINE, "line");
    const stub = stubRetell([await goodCall(db)]);
    const { call, cancel, sim } = setup(db, { live: liveWith(db, stub) });

    const result = await call();
    expect(result).toMatchObject({ mode: "live", outcome: { ticket: "BT-48213", credits: SEED_PLAN.promoAccounts, cancelled_lines: SEED_PLAN.cancelLines.map(lineKey) } });
    expect(sim).not.toHaveBeenCalled();
    const [row] = await db.select().from(calls).where(eq(calls.id, result.callId));
    expect(row).toMatchObject({ mode: "live", toNumber: LINE_NUMBER, outcomeJson: result.outcome });
    expect(row!.recordingUrl).toBeTruthy();
    expect((row!.transcriptJson as TranscriptRow[])[0]!.content).toBe(DISCLOSURE_LINE);
    expect(await actionStatus(db, CALL)).toBe("done");
    expect(await statusOf(db, "promo")).toBe("won");
    await cancel(line, result.callId);
    expect(await statusOf(db, line)).toBe("won");
  });

  test("the call's cost reaches the budget", async (db) => {
    const add = vi.fn<Budget["add"]>(async () => STATUS);
    const stub = stubRetell([await goodCall(db)]);
    await setup(db, { live: liveWith(db, stub), budget: { add, status: async () => STATUS } }).call();
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]![1]).toBeCloseTo(0.29 + 3 * 0.07);
  });

  test("a dial that timed out reaches the budget at the 5 minute cap, and falls back with no second dial", async (db) => {
    const add = vi.fn<Budget["add"]>(async () => STATUS);
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    const live = liveWith(db, { ...stubRetell([]), fetchImpl });
    const result = await setup(db, { live, budget: { add, status: async () => STATUS } }).call();
    expect(result).toMatchObject({ mode: "sim", fallbackReason: expect.stringContaining("timed out") });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
    // The sim fallback may add its own cost on top.
    expect(add.mock.calls[0]![1]).toBeGreaterThanOrEqual(5 * 0.0882 + 0.0208 + 5 * 0.07);
  });

  test("a retry returns the finished live call and does not dial again", async (db) => {
    const stub = stubRetell([await goodCall(db)]);
    const { call } = setup(db, { live: liveWith(db, stub) });
    const first = await call();
    expect(await call()).toMatchObject({ callId: first.callId, repeated: true });
    expect(stub.dials()).toHaveLength(1);
  });

  test("a number not on the allowlist never dials, whatever the engine would do", async (db) => {
    const stub = stubRetell([await goodCall(db)]);
    const { call, sim } = setup(db, { live: liveWith(db, stub), allowlist: { ...ALLOWED, callNumbers: ["+15550003333"] } });
    await expect(call()).rejects.toThrow("not on the allowlist");
    expect(stub.requests).toEqual([]);
    expect(sim).not.toHaveBeenCalled();
  });

  test("an alarm line in the plan never dials and starts no sim call", async (db) => {
    await db.update(actions).set({ payloadJson: { ...SEED_PLAN, cancelLines: [ALARM_LINES[0]!] } }).where(eq(actions.id, CALL));
    const stub = stubRetell([]);
    await expect(setup(db, { live: liveWith(db, stub) }).call()).rejects.toThrow(/alarm/);
    expect(stub.requests).toEqual([]);
    expect(await db.select().from(calls)).toEqual([]);
  });

  test("forced failure with no key: no request, and a labelled sim call", async (db) => {
    vi.stubEnv("RETELL_API_KEY", "");
    const stub = stubRetell([]);
    const result = await setup(db, { live: liveWith(db, stub) }).call();
    expect(stub.requests).toEqual([]);
    expect(result).toMatchObject({ mode: "sim", fallbackReason: expect.stringContaining("RETELL_API_KEY") });
    const rows = (await db.select().from(calls))[0]!.transcriptJson as TranscriptRow[];
    expect(rows[1]).toMatchObject({ role: "system", kind: "fallback", content: expect.stringContaining("RETELL_API_KEY") });
    expect(result.outcome.ticket).toBe("BT-48213");
  });

  const fallsBack = (name: string, stubFor: () => ReturnType<typeof stubRetell>, reason: string) =>
    test(`${name} keeps the partial live row and falls back to a labelled sim call`, async (db) => {
      const { call, sim } = setup(db, { live: liveWith(db, stubFor()) });
      const result = await call();
      expect(sim).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ mode: "sim", fallbackReason: expect.stringContaining(reason), outcome: { ticket: "BT-48213" } });

      const rows = await db.select().from(calls);
      expect(rows).toHaveLength(2);
      const live = rows.find((row) => row.mode === "live")!;
      const simRow = rows.find((row) => row.mode === "sim")!;
      expect(live.outcomeJson).toBeNull();
      expect(live.endedAt).toBeInstanceOf(Date);
      expect((live.transcriptJson as TranscriptRow[]).at(-1)).toMatchObject({ kind: "status", content: expect.stringContaining("Live call failed") });
      expect((simRow.transcriptJson as TranscriptRow[])[1]).toMatchObject({ role: "system", kind: "fallback", content: expect.stringContaining(reason) });
    });

  fallsBack("a refused dial", () => stubRetell([], { dialStatus: 500 }), "HTTP 500");
  fallsBack("a call that never connected", () => stubRetell([{ call_status: "not_connected", disconnection_reason: "dial_failed" }]), "dial_failed");
  fallsBack("a call that ended with no ticket", () => stubRetell([endedCall([said("agent", DISCLOSURE_LINE), said("user", "Goodbye.")])]), "no ticket");

  test("after a fallback, a retry returns the sim call and never dials again", async (db) => {
    const stub = stubRetell([], { dialStatus: 500 });
    const { call } = setup(db, { live: liveWith(db, stub) });
    const first = await call();
    expect(await call()).toMatchObject({ callId: first.callId, repeated: true });
    expect(stub.dials()).toHaveLength(1);
  });

  test("user_hangup does not start the fallback", async (db) => {
    const stub = stubRetell([await goodCall(db)]);
    const { call, sim } = setup(db, { live: liveWith(db, stub) });
    expect((await call()).mode).toBe("live");
    expect(sim).not.toHaveBeenCalled();
  });
});

describe("cancel_service", () => {
  test("records a line the outcome confirms, and a repeat changes nothing", async (db) => {
    const id = await seedCancel(db, LINE, "line");
    const { call, cancel } = setup(db);
    const { callId } = await call();
    await expect(cancel(id, callId)).resolves.toEqual({ recorded: LINE });
    await expect(cancel(id, callId)).resolves.toEqual({ recorded: LINE });
    expect(await statusOf(db, id)).toBe("won");
    expect(await actionStatus(db, id)).toBe("done");
  });

  test("never records an alarm line, even when a tampered outcome lists it", async (db) => {
    const alarm = ALARM_LINES[0]!;
    const id = await seedCancel(db, alarm, "alarm");
    const { call, cancel } = setup(db);
    const { callId, outcome } = await call();
    await db.update(calls).set({ outcomeJson: { ...outcome, cancelled_lines: [alarm] } }).where(eq(calls.id, callId));
    await expect(cancel(id, callId)).rejects.toThrow(/alarm/);
    expect(await statusOf(db, id)).toBe("proposed");
    expect(await actionStatus(db, id)).toBe("approved");
  });

  test("records nothing for a call with no outcome, or an unknown call", async (db) => {
    const id = await seedCancel(db, LINE, "line");
    const [open] = await db.insert(calls).values({ actionId: CALL, mode: "sim", toNumber: LINE_NUMBER }).returning();
    const { cancel } = setup(db);
    await expect(cancel(id, open!.id)).rejects.toThrow("no outcome");
    await expect(cancel(id, "missing")).rejects.toThrow("no outcome");
    expect(await statusOf(db, id)).toBe("proposed");
  });

  test("refuses an action that is not a cancel on an unused line finding", async (db) => {
    const promo = await seedPromo(db, PROMO, "promo");
    await db.insert(actions).values({ id: "promo-cancel", findingId: promo, kind: "cancel", status: "approved" });
    const { call, cancel } = setup(db);
    const { callId } = await call();
    await expect(cancel(CALL, callId)).rejects.toThrow("not one");
    await expect(cancel("promo-cancel", callId)).rejects.toThrow("not one");
    await expect(cancel("missing", callId)).rejects.toThrow("not one");
    expect(await actionStatus(db, "promo-cancel")).toBe("approved");
  });

  test("contacts nobody, so the allowlist cannot block it", async (db) => {
    const id = await seedCancel(db, LINE, "line");
    const { callId } = await setup(db).call();
    await expect(setup(db, { allowlist: { ...ALLOWED, callNumbers: [] } }).cancel(id, callId)).resolves.toEqual({ recorded: LINE });
  });
});

describe("the real tool file", () => {
  it("loads with both tools, and importing it needs no platform or valid VOICE_MODE", async () => {
    vi.stubEnv("VOICE_MODE", "lvie");
    vi.stubEnv("PLATFORM", "not-a-platform");
    const names = (await loadTools()).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["call_provider", "cancel_service"]));
  });
});
