import type { Db } from "@bill-fighter/db/client";
import { accounts, approvals, findings, ledger, locations, runs, smsMessages } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { generateSeed } from "@bill-fighter/db/seed/generate";
import { loadSeed } from "@bill-fighter/db/seed/load";
import { withTestDb } from "@bill-fighter/db/test-db";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  advanceSandbox,
  approveSandbox,
  cloneDemoCustomer,
  isSandboxReplay,
  rekey,
  resetSandboxCache,
  restartSandbox,
  SANDBOX_SPEED,
  sandboxPlan,
  sandboxRunId,
  startSandboxRun,
} from "./sandbox.ts";

const plan = sandboxPlan();
const START = Date.parse("2026-11-08T09:00:00.000Z");
// Wall time at which the recording reaches t, at the sandbox speed.
const at = (t: number, from = START) => from + t / SANDBOX_SPEED;
const END = plan.events.at(-1)!.t;

beforeEach(resetSandboxCache);

async function judge(db: Db, customerId: string) {
  await cloneDemoCustomer(db.$client, customerId);
  return startSandboxRun(db, customerId, START);
}

const totals = async (db: Db, customerId: string) =>
  Object.fromEntries(
    (await db.select({ kind: ledger.kind, cents: sql<number>`sum(${ledger.amountCents})::int` }).from(ledger).where(eq(ledger.customerId, customerId)).groupBy(ledger.kind)).map(
      ({ kind, cents }) => [kind, cents],
    ),
  );

describe("rekey", () => {
  const known = new Set(["a1", "bill-1"]);
  it("prefixes ids and foreign keys, maps the demo customer, leaves free text alone", () => {
    expect(rekey({ id: "a1", finding_id: "a1", billIds: ["bill-1", "other"], customerId: CUSTOMER.id, title: "a1", detail: { months: [{ billId: "bill-1" }] } }, "c", known)).toEqual({
      id: "c:a1",
      finding_id: "c:a1",
      billIds: ["c:bill-1", "other"],
      customerId: "c",
      title: "a1",
      detail: { months: [{ billId: "c:bill-1" }] },
    });
  });
});

describe("sandboxPlan", () => {
  it("waits at the recorded approval and drops the recorded decision and YES", () => {
    expect(plan.events.some(({ table, row }) => table === "approvals" && row?.status === "approved")).toBe(false);
    expect(plan.events.some(({ table, row }) => table === "sms_messages" && row?.direction === "inbound")).toBe(false);
    expect(plan.events.some(({ table, row, t }) => table === "approvals" && row?.status === "pending" && t < plan.approvalT)).toBe(true);
  });
});

// Each test generates and loads the whole seed, which runs long while the full suite shares the machine.
describe("the judge sandbox", { timeout: 180_000 }, () => {
  it("gives two judges at once their own replay, and leaves the demo customer untouched", () =>
    withTestDb("sandbox_two", async (db) => {
      await loadSeed(db, generateSeed());
      const [a, b] = ["sandbox-a", "sandbox-b"];
      await Promise.all([judge(db, a), judge(db, b)]);
      // Both judges poll at once, from two tabs each.
      const late = at(plan.approvalT + 60_000);
      await Promise.all([a, b, a, b].map((customerId) => advanceSandbox(db, customerId, late)));

      for (const customerId of [a, b]) {
        const [run] = await db.select().from(runs).where(eq(runs.customerId, customerId));
        expect(run!.id).toBe(sandboxRunId(customerId));
        expect(isSandboxReplay(run!.replay)).toBe(true);
        // Paused at the approval: nothing after it has played.
        expect((await db.select().from(approvals).where(eq(approvals.runId, run!.id)))[0]!.status).toBe("pending");
        expect(await db.$count(ledger, eq(ledger.customerId, customerId))).toBe(0);
        const own = await db.select({ accountId: findings.accountId }).from(findings).where(eq(findings.customerId, customerId));
        expect(own.length).toBeGreaterThan(0);
        // Every finding points at this judge's own copy of an account.
        for (const { accountId } of own) if (accountId) expect(accountId.startsWith(`${customerId}:`)).toBe(true);
      }
      expect(await db.$count(findings, eq(findings.customerId, a))).toBe(await db.$count(findings, eq(findings.customerId, b)));
      expect(await db.$count(runs, eq(runs.customerId, CUSTOMER.id))).toBe(0);
      expect(await db.$count(findings, eq(findings.customerId, CUSTOMER.id))).toBe(0);
      expect(await db.$count(locations, eq(locations.customerId, a))).toBe(await db.$count(locations, eq(locations.customerId, CUSTOMER.id)));
      expect(await db.$count(accounts)).toBe(3 * (await db.$count(accounts, sql`not ${accounts.id} like 'sandbox-%'`)));
    }));

  it("plays on from the judge's approval to the recorded numbers, and only once per decision", () =>
    withTestDb("sandbox_approve", async (db) => {
      await loadSeed(db, generateSeed());
      const customerId = "sandbox-j";
      const runId = await judge(db, customerId);
      await advanceSandbox(db, customerId, at(plan.approvalT));

      const tap = at(plan.approvalT) + 45_000;
      const [first, second] = await Promise.all([approveSandbox(db, runId, "Linda Park", tap), approveSandbox(db, runId, "Linda Park", tap + 1)]);
      expect(first).toMatchObject({ status: "approved", channel: "dashboard" });
      expect(second!.approvedAt).toEqual(first!.approvedAt);

      // The recording carries on from the tap, not from where its clock would have been.
      await advanceSandbox(db, customerId, tap + 1000);
      expect(await db.$count(ledger, eq(ledger.customerId, customerId))).toBe(0);
      await advanceSandbox(db, customerId, at(END, tap - plan.approvalT / SANDBOX_SPEED) + 1);

      const [run] = await db.select().from(runs).where(eq(runs.id, runId));
      expect(run!.status).toBe("success");
      expect((run!.replay as { cursor: number }).cursor).toBe(plan.events.length);
      expect(await totals(db, customerId)).toMatchObject({ refund: 1_260_606, savings: 1_831_932, fee: 927_761 });
      expect((await db.select().from(approvals).where(eq(approvals.runId, runId)))[0]).toMatchObject({ status: "approved", channel: "dashboard" });
      const texts = await db.select().from(smsMessages).where(sql`starts_with(${smsMessages.id}, ${`${customerId}:`})`);
      expect(texts.map(({ direction }) => direction)).toEqual(["outbound"]);
    }));

  it("starts over on Watch it again, touching only the judge's rows", () =>
    withTestDb("sandbox_restart", async (db) => {
      await loadSeed(db, generateSeed());
      const [a, b] = ["sandbox-a", "sandbox-b"];
      await Promise.all([judge(db, a), judge(db, b)]);
      await Promise.all([a, b].map((customerId) => advanceSandbox(db, customerId, at(plan.approvalT))));
      const before = await db.$count(findings, eq(findings.customerId, b));

      await restartSandbox(db, a, START + 3_600_000);
      expect(await db.$count(findings, eq(findings.customerId, a))).toBe(0);
      expect(await db.$count(findings, eq(findings.customerId, b))).toBe(before);
      const [run] = await db.select().from(runs).where(eq(runs.customerId, a));
      expect(run!.replay).toMatchObject({ cursor: expect.any(Number), approvedAt: null, startedAt: new Date(START + 3_600_000).toISOString() });
    }));
});
