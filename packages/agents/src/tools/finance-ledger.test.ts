import type { Db } from "@bill-fighter/db/client";
import { accounts, actions, customers, findings, ledger, phoneLines, runs } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import type { Audit } from "@bill-fighter/platform/types";
import type { Allowlist } from "@bill-fighter/shared/allowlist";
import { LINE_NUMBER } from "@bill-fighter/voice/live/line/script";
import { runSimCall } from "@bill-fighter/voice/sim/engine";
import { SEED_PLAN, seedCallData, seedCallFacts } from "@bill-fighter/voice/sim/fixture";
import { stubLlm } from "@bill-fighter/voice/sim/stub-llm";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { loadTools } from "../registry.ts";
import { wrapTool } from "../tool-wrapper.ts";
import { financeLedgerTools } from "./finance-ledger.ts";
import { negotiatorTools } from "./negotiator.ts";

const RUN = "run-1";
const CUSTOMER_ID = `customer-${RUN}`;
const CTX = { runId: RUN, agent: "finance" };
const ALLOWED: Allowlist = { callNumbers: [LINE_NUMBER], emailDomains: [], portalOrigins: [] };
const AUDIT: Audit = { record: async () => {}, list: async () => [] };
const STATUS = { totalUsd: 0, capUsd: 5, over: false };

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("finance_ledger", fn));

const record = (db: Db, input: unknown = {}, ctx = CTX) => wrapTool(financeLedgerTools({ db })[0]!, { audit: AUDIT, allowlist: ALLOWED }).handler(input, ctx);

type Seed = { id: string; type: string; status: "proposed" | "approved" | "filed" | "won" | "rejected"; refund?: number; savings?: number; customerId?: string; accountId?: string };

const seedFinding = (db: Db, { id, type, status, refund = 0, savings = 0, customerId = CUSTOMER_ID, accountId }: Seed, phoneLineIds: string[] = []) =>
  db.insert(findings).values({
    id,
    customerId,
    accountId,
    type,
    status,
    title: id,
    explanation: id,
    evidenceJson: { billIds: [], billLineIds: [], phoneLineIds, detail: {} },
    refundCents: refund,
    annualSavingsCents: savings,
    confidence: 0.9,
  });

const rowsOf = (db: Db, findingId: string) => db.select().from(ledger).where(eq(ledger.findingId, findingId));
const feeRow = async (db: Db, customerId = CUSTOMER_ID) => (await db.select().from(ledger).where(and(eq(ledger.customerId, customerId), eq(ledger.kind, "fee"))))[0];

describe("record_savings", () => {
  test("records the finding's amounts, and the fee to the cent at 30%", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, { id: "meter", type: "meterMultiplierJump", status: "filed", refund: 1_234_567, savings: 1_000_000 });
    await seedFinding(db, { id: "line", type: "unusedLines", status: "won", savings: 999_999 });

    expect(await record(db)).toEqual({ refundCents: 1_234_567, annualSavingsCents: 1_999_999, feeCents: 970_370, customerKeepsCents: 2_264_196 });
    expect(await feeRow(db)).toMatchObject({ id: `fee-${CUSTOMER_ID}`, findingId: null, amountCents: 970_370 });
  });

  test("uses the customer's savings_share_pct", async (db) => {
    await seedRun(db, RUN);
    await db.update(customers).set({ savingsSharePct: 25 }).where(eq(customers.id, CUSTOMER_ID));
    await seedFinding(db, { id: "meter", type: "meterMultiplierJump", status: "filed", refund: 1_000 });

    expect(await record(db)).toMatchObject({ feeCents: 250, customerKeepsCents: 750 });
    expect((await feeRow(db))!.amountCents).toBe(250);
  });

  test("a refund is recorded as claimed, and its finding is not won", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, { id: "meter", type: "meterMultiplierJump", status: "filed", refund: 1_000 });
    await record(db);

    expect(await rowsOf(db, "meter")).toMatchObject([{ kind: "refund", amountCents: 1_000, description: "Claimed, due only when granted" }]);
    expect((await db.select().from(findings).where(eq(findings.id, "meter")))[0]!.status).toBe("filed");
  });

  test("savings say whether they are filed or won, and the wording follows the finding", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, { id: "rate", type: "rateOptimization", status: "filed", savings: 1_000 });
    await seedFinding(db, { id: "line", type: "unusedLines", status: "won", savings: 2_000 });
    await record(db);
    expect((await rowsOf(db, "rate"))[0]!.description).toBe("Filed, due only when granted");
    expect((await rowsOf(db, "line"))[0]!.description).toBe("First year savings");

    await db.update(findings).set({ status: "won", annualSavingsCents: 9_999 }).where(eq(findings.id, "rate"));
    await record(db);
    // The wording moved on, and the recorded amount did not.
    expect(await rowsOf(db, "rate")).toMatchObject([{ amountCents: 1_000, description: "First year savings" }]);
  });

  test("items the rep refused on a real sim call are not counted, and their confirmed siblings are", async (db) => {
    const call = "call-action";
    await seedCallData(db, call);
    await seedCallFacts(db, call);
    await db.update(actions).set({ payloadJson: SEED_PLAN }).where(eq(actions.id, call));
    await db.insert(runs).values({ id: RUN, customerId: CUSTOMER.id, platform: "local", trigger: "manual", status: "running" });

    const [refusedPromo, wonPromo] = SEED_PLAN.promoAccounts as [string, string];
    const [refusedLine, wonLine] = SEED_PLAN.cancelLines as [string, string];
    const accountOf = async (number: string) => (await db.select().from(accounts).where(eq(accounts.accountNumber, number)))[0]!.id;
    await seedFinding(db, { id: "promo-refused", type: "promoExpiry", status: "proposed", savings: 1_000, customerId: CUSTOMER.id, accountId: await accountOf(refusedPromo) });
    await seedFinding(db, { id: "promo-won", type: "promoExpiry", status: "proposed", savings: 2_000, customerId: CUSTOMER.id, accountId: await accountOf(wonPromo) });

    const seedLine = async (id: string, number: string, savings: number) => {
      const [line] = await db.select().from(phoneLines).where(eq(phoneLines.number, number));
      await seedFinding(db, { id, type: "unusedLines", status: "proposed", savings, customerId: CUSTOMER.id, accountId: line!.accountId }, [line!.id]);
      await db.insert(actions).values({ id, findingId: id, kind: "cancel", status: "approved" });
    };
    await seedLine("line-refused", refusedLine, 4_000);
    await seedLine("line-won", wonLine, 8_000);

    const { llm } = stubLlm();
    const tools = negotiatorTools({
      db,
      budget: async () => ({ add: async () => STATUS, status: async () => STATUS }),
      sim: (engineCall) => runSimCall({ db, llm, ...engineCall, refuse: [refusedPromo, refusedLine] }),
      live: async () => {
        throw new Error("live is not used here");
      },
    });
    const use = (name: string, input: unknown) => wrapTool(tools.find((tool) => tool.name === name)!, { audit: AUDIT, allowlist: ALLOWED }).handler(input, { runId: RUN, agent: "negotiator" });

    const { callId } = (await use("call_provider", { actionId: call })) as { callId: string };
    await use("cancel_service", { actionId: "line-won", callId });
    await expect(use("cancel_service", { actionId: "line-refused", callId })).rejects.toThrow("does not confirm");

    expect(await record(db)).toMatchObject({ annualSavingsCents: 10_000, feeCents: 3_000 });
    expect(await rowsOf(db, "promo-refused")).toEqual([]);
    expect(await rowsOf(db, "line-refused")).toEqual([]);
    expect(await rowsOf(db, "promo-won")).toHaveLength(1);
    expect(await rowsOf(db, "line-won")).toHaveLength(1);
  });

  test("a line or promo counts only when won, and other statuses and types never count", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, { id: "line-filed", type: "unusedLines", status: "filed", savings: 1 });
    await seedFinding(db, { id: "line-approved", type: "unusedLines", status: "approved", savings: 2 });
    await seedFinding(db, { id: "promo-filed", type: "promoExpiry", status: "filed", savings: 4 });
    await seedFinding(db, { id: "promo-proposed", type: "promoExpiry", status: "proposed", savings: 8 });
    await seedFinding(db, { id: "meter-proposed", type: "meterMultiplierJump", status: "proposed", refund: 16 });
    await seedFinding(db, { id: "rate-rejected", type: "rateOptimization", status: "rejected", savings: 32 });
    await seedFinding(db, { id: "unknown-won", type: "aRuleNotBuiltYet", status: "won", savings: 64 });

    expect(await record(db)).toEqual({ refundCents: 0, annualSavingsCents: 0, feeCents: 0, customerKeepsCents: 0 });
    expect((await db.select().from(ledger)).map((row) => row.kind)).toEqual(["fee"]);
  });

  test("running twice does not double count", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, { id: "meter", type: "meterMultiplierJump", status: "filed", refund: 1_000, savings: 2_000 });
    const first = await record(db);
    expect(await db.select().from(ledger)).toHaveLength(3);

    expect(await record(db)).toEqual(first);
    expect(await db.select().from(ledger)).toHaveLength(3);
  });

  test("overlapping uses write each row once and the right fee", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, { id: "meter", type: "meterMultiplierJump", status: "filed", refund: 1_000, savings: 2_000 });
    const results = await Promise.all([record(db), record(db), record(db)]);

    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(await db.select().from(ledger)).toHaveLength(3);
    expect((await feeRow(db))!.amountCents).toBe(900);
  });

  test("a finding won after the first use raises the same fee row", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, { id: "meter", type: "meterMultiplierJump", status: "filed", refund: 1_000 });
    await seedFinding(db, { id: "line", type: "unusedLines", status: "proposed", savings: 1_000 });
    expect(await record(db)).toMatchObject({ feeCents: 300 });

    await db.update(findings).set({ status: "won" }).where(eq(findings.id, "line"));
    expect(await record(db)).toMatchObject({ feeCents: 600 });
    expect(await db.select().from(ledger).where(eq(ledger.kind, "fee"))).toHaveLength(1);
  });

  test("another customer's findings and ledger stay out of it", async (db) => {
    await seedRun(db, RUN);
    await seedRun(db, "run-2");
    await seedFinding(db, { id: "mine", type: "meterMultiplierJump", status: "filed", refund: 1_000 });
    await seedFinding(db, { id: "theirs", type: "meterMultiplierJump", status: "filed", refund: 5_000, customerId: "customer-run-2" });
    await record(db, {}, { runId: "run-2", agent: "finance" });

    expect(await record(db)).toMatchObject({ refundCents: 1_000, feeCents: 300 });
    expect((await feeRow(db, "customer-run-2"))!.amountCents).toBe(1_500);
  });

  test("zero amounts write no rows", async (db) => {
    await seedRun(db, RUN);
    await seedFinding(db, { id: "line", type: "unusedLines", status: "won" });
    await record(db);
    expect(await rowsOf(db, "line")).toEqual([]);
  });

  test("an unknown run records nothing", async (db) => {
    await expect(record(db, {}, { runId: "missing", agent: "finance" })).rejects.toThrow("does not exist");
    expect(await db.select().from(ledger)).toEqual([]);
  });

  it("its schema refuses an amount or a finding from the model", () => {
    const { inputSchema } = financeLedgerTools()[0]!;
    expect(inputSchema.safeParse({}).success).toBe(true);
    expect(inputSchema.safeParse({ refundCents: 100 }).success).toBe(false);
    expect(inputSchema.safeParse({ findingIds: ["x"] }).success).toBe(false);
  });
});

describe("the real tool file", () => {
  it("loads record_savings with no platform needed", async () => {
    vi.stubEnv("PLATFORM", "not-a-platform");
    const names = (await loadTools()).map((tool) => tool.name);
    vi.unstubAllEnvs();
    expect(names).toContain("record_savings");
  });
});
