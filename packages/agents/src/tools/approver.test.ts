import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@bill-fighter/db/client";
import { accounts, actions, approvals, findings, phoneLines, runs, smsMessages } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { withTestDb } from "@bill-fighter/db/test-db";
import { createApprovalGate } from "@bill-fighter/platform/local/approval-gate";
import { createIdentity } from "@bill-fighter/platform/local/identity";
import { createSms } from "@bill-fighter/platform/local/sms";
import type { Mail } from "@bill-fighter/platform/types";
import { ALARM_LINES, SEED_PLAN, seedCallData } from "@bill-fighter/voice/sim/fixture";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALARM_NUMBER, FAX_NUMBER, run as runTool, seedFindings } from "../test-fixtures.ts";
import { wrapTool } from "../tool-wrapper.ts";
import { approverTools, bundleLines } from "./approver.ts";
import { filerTools, letterActionId } from "./filer.ts";

const RUN = "run";
const SUMMARY = "Please approve the claim, the rate changes and the cancellations.";

type Bundle = { approvalId: string; actionIds: string[]; status: string; summary: string };

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("tools_file_approve_approver", fn));

function setup(db: Db, overrides: Parameters<typeof approverTools>[0] = {}) {
  const gate = createApprovalGate(db);
  const tools = approverTools({ db, gate: async () => gate, sms: async () => createSms(db, createIdentity({})), mode: () => "local", ...overrides });
  const request = (actionIds: string[] = [], summary = SUMMARY, runId = RUN) => runTool(tools, "request_approval", { actionIds, summary }, runId) as Promise<Bundle>;
  return { gate, tools, request };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("request_approval: the call-provider-tool contract", () => {
  /** The real seed's lines and accounts, with findings shaped as the rules write them. */
  async function seedDemo(db: Db) {
    await seedCallData(db, "unrelated-action");
    await db.insert(runs).values({ id: RUN, customerId: CUSTOMER.id, platform: "local", trigger: "email", status: "running" });
    const lines = await db.select().from(phoneLines);
    const evidence = (lineId: string, detail: object) => ({ billIds: [], billLineIds: [], phoneLineIds: [lineId], detail });
    const lineFinding = (line: (typeof lines)[number], id: string, action: string) => ({
      id,
      customerId: CUSTOMER.id,
      accountId: line.accountId,
      type: "unusedLines",
      title: id,
      explanation: id,
      evidenceJson: evidence(line.id, { number: line.number, purpose: line.purpose, action }),
      annualSavingsCents: action === "cancel" ? 72_000 : 0,
      confidence: 0.9,
    });
    const unused = lines.filter((line) => line.purpose !== "alarm" && line.purpose !== "voice" && line.callsLast12mo === 0);
    const alarms = lines.filter((line) => line.purpose === "alarm");
    const promoRows = await db.select().from(accounts).where(inArray(accounts.accountNumber, SEED_PLAN.promoAccounts));
    await db.insert(findings).values([
      ...unused.map((line) => lineFinding(line, `unused-${line.id}`, "cancel")),
      ...alarms.map((line) => lineFinding(line, `alarm-${line.id}`, "confirmWithAlarmCompany")),
      // Mislabelled as cancellable: phone_lines must still keep it out.
      lineFinding(alarms[0]!, "alarm-mislabelled", "cancel"),
      ...promoRows.map((account) => ({
        id: `promo-${account.id}`,
        customerId: CUSTOMER.id,
        accountId: account.id,
        type: "promoExpiry",
        title: "promo",
        explanation: "promo",
        evidenceJson: { billIds: ["b"], billLineIds: [], phoneLineIds: [], detail: {} },
        annualSavingsCents: 108_000,
        confidence: 0.8,
      })),
    ]);
    return { unused };
  }

  test("creates the call action as the sim engine's plan, with seven cancels, no alarm line and no promos", async (db) => {
    const { unused } = await seedDemo(db);
    const bundle = await setup(db).request();

    const [call] = await db.select().from(actions).where(eq(actions.id, `call-${RUN}`));
    expect(call).toMatchObject({ kind: "call", findingId: null, status: "proposed", requiresApproval: true });
    const plan = call!.payloadJson as typeof SEED_PLAN;
    expect(Object.keys(plan).sort()).toEqual(["accountNumber", "cancelLines", "promoAccounts"]);
    expect(plan.accountNumber).toBe(SEED_PLAN.accountNumber);
    expect([...plan.cancelLines].sort()).toEqual([...SEED_PLAN.cancelLines].sort());
    // Promos are off the call to keep it short, so the owner is told they stay open.
    expect(plan.promoAccounts).toEqual([]);
    expect(bundle!.summary).toContain("We found 3 expired promo rates. This approval does not act on them.");
    expect(bundle!.summary).not.toMatch(/restore/);
    expect(plan.cancelLines.filter((line) => ALARM_LINES.includes(line))).toEqual([]);

    const cancels = (await db.select().from(actions).where(eq(actions.kind, "cancel"))).map((action) => action.findingId).sort();
    expect(cancels).toEqual(unused.map((line) => `unused-${line.id}`).sort());
    expect(cancels).toHaveLength(7);

    expect(bundle.actionIds).toEqual(expect.arrayContaining([`call-${RUN}`, `invoice-${RUN}`, ...cancels.map((findingId) => `cancel-${RUN}-${findingId}`)]));
    expect(bundle.actionIds).not.toContain("unrelated-action");
    expect(bundle.summary).toContain("On the BayTel call we will cancel 7 unused lines.");
  });
});

describe("request_approval", () => {
  test("creates one invoice action with no finding and no amount", async (db) => {
    await seedFindings(db, RUN);
    await setup(db).request();
    const [invoice] = await db.select().from(actions).where(eq(actions.id, `invoice-${RUN}`));
    expect(invoice).toMatchObject({ kind: "invoice", findingId: null, status: "proposed" });
    expect(JSON.stringify(invoice!.payloadJson)).not.toMatch(/\d{3}|amount|cents/i);
  });

  test("the bundle holds the model's ids, and a letter the model forgot, but no other run's letter", async (db) => {
    const { id } = await seedFindings(db, RUN);
    const other = await seedFindings(db, `${RUN}-2`);
    const foreign = letterActionId(`${RUN}-2`, other.id("meter"));
    await db.insert(actions).values([
      { id: letterActionId(RUN, id("meter")), findingId: id("meter"), kind: "claim", status: "proposed", payloadJson: { letterPath: "l", evidencePath: "e" } },
      { id: letterActionId(RUN, id("rate")), findingId: id("rate"), kind: "plan_change", status: "proposed", payloadJson: { letterPath: "l", evidencePath: "e" } },
      // This run's id is a prefix of that run's id, so a prefix match would take it.
      { id: foreign, findingId: other.id("meter"), kind: "claim", status: "proposed" },
    ]);
    const { request } = setup(db);
    await expect(request([foreign])).rejects.toThrow(/not actions of this run/);
    const { actionIds } = await request([letterActionId(RUN, id("meter"))]);
    expect(actionIds).toEqual(expect.arrayContaining([letterActionId(RUN, id("meter")), letterActionId(RUN, id("rate"))]));
    expect(actionIds).not.toContain(foreign);
    expect(new Set(actionIds).size).toBe(actionIds.length);
  });

  test("refuses another run's action, also a denied run's, and writes nothing", async (db) => {
    await seedFindings(db, RUN);
    const other = await seedFindings(db, "other");
    const foreign = letterActionId("other", other.id("meter"));
    await db.insert(actions).values({ id: foreign, findingId: other.id("meter"), kind: "claim", status: "proposed" });
    const { request, gate } = setup(db);

    await expect(request([foreign])).rejects.toThrow(/not actions of this run/);
    await gate.createBundle({ runId: "other", actionIds: [foreign], summary: "s" });
    await gate.decide({ runId: "other", status: "denied", channel: "dashboard", approvedBy: "Linda" });
    await expect(request([foreign])).rejects.toThrow(/not actions of this run/);

    expect(await gate.get(RUN)).toBeNull();
    expect((await db.select().from(actions)).map((action) => action.id)).toEqual([foreign]);
  });

  test("a second call reuses the row, also after the decision", async (db) => {
    await seedFindings(db, RUN);
    const { request, gate } = setup(db);
    const first = await request();
    expect(first.status).toBe("pending");
    const count = (await db.select().from(actions)).length;

    expect(await request(["ignored"], "Another summary.")).toEqual(first);
    await gate.decide({ runId: RUN, status: "approved", channel: "dashboard", approvedBy: "Linda" });
    expect(await request()).toMatchObject({ approvalId: first.approvalId, status: "approved" });
    expect(await db.select().from(approvals)).toHaveLength(1);
    expect(await db.select().from(actions)).toHaveLength(count);
  });

  test("two racing calls leave one row and one of each action", async (db) => {
    await seedFindings(db, RUN);
    const { request } = setup(db);
    const [a, b] = await Promise.all([request(), request()]);
    expect(a!.approvalId).toBe(b!.approvalId);
    expect(await db.select().from(approvals)).toHaveLength(1);
    expect(await db.select().from(actions).where(eq(actions.kind, "call"))).toHaveLength(1);
    expect(await db.select().from(actions).where(eq(actions.kind, "invoice"))).toHaveLength(1);
  });

  test("leaves alarm lines out of a mixed customer's call, and adds code-made totals to the summary", async (db) => {
    await seedFindings(db, RUN);
    const { summary } = await setup(db).request();
    const [call] = await db.select().from(actions).where(eq(actions.id, `call-${RUN}`));
    expect(call!.payloadJson).toEqual({ accountNumber: `BT-${RUN}`, cancelLines: [FAX_NUMBER], promoAccounts: [] });
    expect(JSON.stringify(call!.payloadJson)).not.toContain(ALARM_NUMBER);
    // 175_000 refund; 123_400 + 80_000 + 72_000 yearly. The 108_000 promo is not acted on, so it is not counted.
    expect(summary).toContain("Refund to claim: $1,750.00. Yearly savings: $2,754.00.");
    expect(summary).toContain("We found 1 expired promo rate. This approval does not act on it.");
  });

  test("refuses a summary with its own numbers, and an unknown action id", async (db) => {
    await seedFindings(db, RUN);
    const { request } = setup(db);
    await expect(request([], "Save $20,000 a year!")).rejects.toThrow(/\$20,000/);
    await expect(request(["no-such-action"])).rejects.toThrow(/not actions of this run/);
    expect(await db.select().from(approvals)).toEqual([]);
  });
});

describe("what the owner is told the bundle does", () => {
  const call = (cancelLines: string[], promoAccounts: string[]) => ({ kind: "call", payloadJson: { accountNumber: "A", cancelLines, promoAccounts } });
  const bare = (kind: string, count = 1) => Array.from({ length: count }, () => ({ kind, payloadJson: null }));

  it("words a call from its plan's counts, dropping an empty half", () => {
    const seven = Array.from({ length: 7 }, (_, line) => `line-${line}`);
    expect(bundleLines([call(seven, ["a", "b", "c"])])).toEqual(["On the BayTel call we will cancel 7 unused lines and ask to restore 3 promo rates."]);
    expect(bundleLines([call(["l", "m"], ["a", "b"])])).toEqual(["On the BayTel call we will cancel 2 unused lines and ask to restore 2 promo rates."]);
    expect(bundleLines([call(["l"], [])])).toEqual(["On the BayTel call we will cancel 1 unused line."]);
    expect(bundleLines([call([], ["a"])])).toEqual(["On the BayTel call we will ask to restore 1 promo rate."]);
  });

  it("lists every other kind with its count, and says nothing about a kind not in the bundle", () => {
    expect(bundleLines([...bare("claim"), ...bare("plan_change", 2), ...bare("letter", 3), ...bare("invoice"), ...bare("cancel", 3)])).toEqual([
      "We will file 1 Rule 17.1 refund claim.",
      "We will file 2 Rule 12 rate change requests.",
      "We have drafted 3 cancellation letters for those lines.",
      "We will invoice you for our fee.",
    ]);
    expect(bundleLines([])).toEqual([]);
  });

  it("refuses a kind it has no wording for, so nothing can be approved unmentioned", () => {
    expect(() => bundleLines(bare("card_pay"))).toThrow(/no wording for a card_pay action/);
  });

  test("the summary and the text both carry it, even when the model's text leaves it out", async (db) => {
    await seedFindings(db, RUN);
    const { tools, request } = setup(db);
    const { summary } = await request();
    const sentence = "On the BayTel call we will cancel 1 unused line.";
    expect(summary).toContain(sentence);
    expect(summary).toContain("We will invoice you for our fee.");
    // The panel shows the top of the summary, so the figures come first, then the code-built lines, then the model's wording.
    expect(summary.startsWith("Refund to claim:")).toBe(true);
    expect(summary.indexOf(sentence)).toBeLessThan(summary.indexOf(SUMMARY));
    expect(summary.endsWith(SUMMARY)).toBe(true);

    await runTool(tools, "send_sms", { body: "Your approval is waiting. Reply YES." }, RUN);
    const [row] = await db.select().from(smsMessages);
    expect(row!.body).toBe(`Your approval is waiting. Reply YES.\n\n${sentence}\nWe will invoice you for our fee.`);
  });

  test("the model's own text is still refused a number of its own", async (db) => {
    await seedFindings(db, RUN);
    const { tools, request } = setup(db);
    await request();
    await expect(runTool(tools, "send_sms", { body: "Cancel 9 lines. Reply YES." }, RUN)).rejects.toThrow(/may not hold numbers/);
    expect(await db.select().from(smsMessages)).toEqual([]);
  });
});

describe("request_approval with the Filer's letters", () => {
  const WORDING = "We ask you to act on this request under Rule 17.1 as the facts below show.";
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "letters-"));
  });
  afterEach(() => rmSync(dir, { recursive: true }));

  async function setupBoth(db: Db, filerGate?: () => Promise<ReturnType<typeof createApprovalGate>>) {
    const { id } = await seedFindings(db, RUN, dir);
    const { gate, request, tools: approver } = setup(db);
    const filer = filerTools({ db, gate: filerGate ?? (async () => gate), lettersDir: dir });
    const call = (name: string, input: unknown) => runTool(filer, name, input, RUN) as Promise<unknown>;
    const letters = ["meter", "rate"].map((name) => ({ findingId: id(name), wording: WORDING }));
    return { id, gate, approver, request, call, letters };
  }

  test("refuses, naming each letter with no evidence and writing nothing, and the Filer can attach and retry", async (db) => {
    const { id, gate, request, call, letters } = await setupBoth(db);
    await call("draft_letter", { letters });
    const meter = letterActionId(RUN, id("meter"));
    const rate = letterActionId(RUN, id("rate"));
    await call("attach_evidence", { actionIds: [meter] });
    const before = await db.select().from(actions);

    const refused = request([meter, rate]);
    await expect(refused).rejects.toThrow(rate);
    await expect(refused).rejects.not.toThrow(meter);
    expect(await gate.get(RUN)).toBeNull();
    expect(await db.select().from(actions)).toEqual(before);

    await call("attach_evidence", { actionIds: [rate] });
    const { actionIds } = await request([meter, rate]);
    expect(actionIds).toEqual(expect.arrayContaining([meter, rate]));

    await gate.decide({ runId: RUN, status: "approved", channel: "dashboard", approvedBy: "Linda" });
    await expect(call("submit_claim", { actionId: meter })).resolves.toMatchObject({ status: "done" });
    await expect(call("change_rate_plan", { actionId: rate })).resolves.toMatchObject({ status: "done" });
  });

  test("a request waits for a running attach_evidence, so it bundles the finished document", async (db) => {
    const real = createApprovalGate(db);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hold = false;
    const { id, gate, approver, call, letters } = await setupBoth(db, async () => {
      if (hold) await held;
      return real;
    });
    await call("draft_letter", { letters: letters.slice(0, 1) });
    const meter = letterActionId(RUN, id("meter"));

    // attach_evidence stops at its first step and stays there until released.
    hold = true;
    const attaching = call("attach_evidence", { actionIds: [meter] });
    // request_approval's first step is reading the gate, so this spy shows whether it has started.
    const started = vi.spyOn(gate, "get");
    const requesting = runTool(approver, "request_approval", { actionIds: [meter], summary: SUMMARY }, RUN) as Promise<Bundle>;
    for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
    expect(started).not.toHaveBeenCalled();

    release();
    await attaching;
    expect((await requesting).actionIds).toContain(meter);
    const [action] = await db.select().from(actions).where(eq(actions.id, meter));
    expect(action!.payloadJson).toMatchObject({ evidencePath: expect.any(String) });
  });

  test("a failed attach_evidence batch finishes its writes before a waiting request can freeze the PDF", async (db) => {
    const { id, request, call, letters } = await setupBoth(db);
    await call("draft_letter", { letters: letters.slice(0, 1) });
    const meter = letterActionId(RUN, id("meter"));
    await call("attach_evidence", { actionIds: [meter] });
    // Removed so the batch's rewrite is visible: the file is back only once that write has ended.
    const pdf = join(dir, `${encodeURIComponent(meter)}-with-evidence.pdf`);
    rmSync(pdf);

    const attaching = call("attach_evidence", { actionIds: [meter, "not-a-letter"] });
    const requesting = request([meter]);
    await expect(attaching).rejects.toThrow(/not a letter of this run/);
    expect(existsSync(pdf)).toBe(true);
    expect((await requesting).actionIds).toContain(meter);
  });
});

describe("send_sms", () => {
  const allowNothing = { callNumbers: [], emailDomains: [], portalOrigins: [] };

  test("goes to the configured owner in local mode, on the phone panel, and passes the allowlist with no target", async (db) => {
    vi.stubEnv("OWNER_PHONE_SIM", "+15550009999");
    await seedFindings(db, RUN);
    const tool = setup(db).tools.find((candidate) => candidate.name === "send_sms")!;
    const audit = { record: vi.fn(async () => {}), list: async () => [] };
    const output = await wrapTool(tool, { audit, allowlist: allowNothing }).handler({ body: "Please check your approval. Reply YES." }, { runId: RUN, agent: "approver" });
    expect(output).toMatchObject({ channel: "sms" });
    const [row] = await db.select().from(smsMessages);
    expect(row).toMatchObject({ direction: "outbound", to: "+15550009999", body: "Please check your approval. Reply YES." });
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it("gives the model no way to name a recipient", () => {
    const tool = approverTools().find((candidate) => candidate.name === "send_sms")!;
    expect(() => tool.inputSchema.parse({ to: "+18005551234", body: "hi" })).toThrow();
    expect(tool.targets({ body: "hi" })).toEqual([]);
  });

  test("accepts only amounts already in the request's summary", async (db) => {
    await seedFindings(db, RUN);
    const { tools, request } = setup(db);
    const send = (body: string) => runTool(tools, "send_sms", { body }, RUN);
    await expect(send("Refund of $1,750.00 is waiting.")).rejects.toThrow(/may not hold numbers/);
    await request();
    await expect(send("Refund of $1,750.00 is waiting. Reply YES.")).resolves.toMatchObject({ channel: "sms" });
    await expect(send("Refund of $9,999.00 is waiting.")).rejects.toThrow(/\$9,999/);
    expect(await db.select().from(smsMessages)).toHaveLength(1);
  });

  test("goes to the customer by email in naïve mode, never by SMS", async (db) => {
    const { customerId } = await seedFindings(db, RUN);
    expect(customerId).toBeTruthy();
    const send = vi.fn<Mail["send"]>(async () => ({ id: "m1" }));
    const sms = vi.fn(async () => {
      throw new Error("naïve SMS is not available");
    });
    const { tools } = setup(db, { mode: () => "naive", mail: async () => ({ send, parseInbound: () => { throw new Error("unused"); } }), sms });
    await expect(runTool(tools, "send_sms", { body: "Please approve. Reply YES." }, RUN)).resolves.toEqual({ id: "m1", channel: "email" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@billfighter.local", text: "Please approve. Reply YES." }));
    expect(sms).not.toHaveBeenCalled();
    expect(await db.select().from(smsMessages)).toEqual([]);
  });
});
