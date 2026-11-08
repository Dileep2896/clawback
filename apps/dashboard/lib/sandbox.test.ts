import type { Db } from "@bill-fighter/db/client";
import { accounts, approvals, calls, customers, findings, ledger, locations, runs, smsMessages } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { generateSeed } from "@bill-fighter/db/seed/generate";
import { loadSeed } from "@bill-fighter/db/seed/load";
import { withTestDb } from "@bill-fighter/db/test-db";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { approveRun } from "./decisions.ts";
import { liveSnapshot } from "./snapshot.ts";
import {
  advanceSandbox,
  approveSandbox,
  cloneDemoCustomer,
  createSandboxUser,
  ipHash,
  isSandboxReplay,
  rekey,
  resetSandboxCache,
  restartSandbox,
  SANDBOX_SPEED,
  type SandboxSignUp,
  SIGNUPS_PER_IP_PER_MINUTE,
  sandboxPlan,
  sandboxRunId,
  startSandboxRun,
  wallTime,
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

const signUp = (email: string, ip: string): SandboxSignUp => ({ name: "Judge Example", company: "Judges Inc", email, passwordHash: "salt:hash", ipHash: ipHash(ip, "test-key") });

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

describe("wallTime", () => {
  const state = { sandbox: true as const, recordedAt: "2026-01-01T00:00:00.000Z", speed: 2, startedAt: "2026-02-01T00:00:00.000Z", cursor: 0, approvedAt: null, pausedMs: 0 };
  it("puts a recorded moment on the judge's clock at their speed, and after their wait once past the approval", () => {
    expect(wallTime("2026-01-01T00:00:10.000+00:00", state, 60_000)).toBe("2026-02-01T00:00:05.000Z");
    // After a 30 s wait the clock's start moved by it: earlier rows keep their time, later ones carry the wait.
    const waited = { ...state, startedAt: "2026-02-01T00:00:30.000Z", pausedMs: 30_000 };
    expect(wallTime("2026-01-01T00:00:10.000Z", waited, 60_000)).toBe("2026-02-01T00:00:05.000Z");
    expect(wallTime("2026-01-01T00:01:10.000Z", waited, 60_000)).toBe("2026-02-01T00:01:05.000Z");
    // Approved early, at 20 s on the judge's clock: what came before the approval lands no later than the tap.
    const early = { ...state, approvedAt: "2026-02-01T00:00:20.000Z" };
    expect(wallTime("2026-01-01T00:00:10.000Z", early, 60_000)).toBe("2026-02-01T00:00:05.000Z");
    expect(wallTime("2026-01-01T00:00:50.000Z", early, 60_000)).toBe("2026-02-01T00:00:20.000Z");
    expect(wallTime("2026-01-01T00:01:10.000Z", early, 60_000)).toBe("2026-02-01T00:00:35.000Z");
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

  it("shows each judge only their own texts on the live dashboard, while their replays overlap and after a restart", () =>
    withTestDb("sandbox_sms_isolation", async (db) => {
      await loadSeed(db, generateSeed());
      const [a, b] = ["sandbox-sa", "sandbox-sb"];
      await cloneDemoCustomer(db.$client, a);
      await cloneDemoCustomer(db.$client, b);
      await startSandboxRun(db, a, START);
      await startSandboxRun(db, b, START + 5_000);
      const texts = async (customerId: string) => (await liveSnapshot(db, customerId)).sms.map(({ id }) => id);

      const both = at(plan.approvalT, START + 5_000);
      await Promise.all([advanceSandbox(db, a, both), advanceSandbox(db, b, both)]);
      for (const customerId of [a, b]) {
        const own = await texts(customerId);
        expect(own).toHaveLength(1);
        expect(own[0]!.startsWith(`${customerId}:`)).toBe(true);
      }

      // b watches it again while a's text is still there, and newer: b sees none until their own plays.
      const again = both + 1_000;
      await restartSandbox(db, b, again);
      await advanceSandbox(db, b, again + 1);
      expect(await texts(b)).toEqual([]);
      await advanceSandbox(db, b, at(plan.approvalT, again));
      expect(await texts(b)).toEqual([expect.stringMatching(new RegExp(`^${b}:`))]);
      expect(await texts(a)).toEqual([expect.stringMatching(new RegExp(`^${a}:`))]);
    }));

  it("plays on from the judge's approval to the recorded numbers, and only once per decision", () =>
    withTestDb("sandbox_approve", async (db) => {
      await loadSeed(db, generateSeed());
      const customerId = "sandbox-j";
      const runId = await judge(db, customerId);
      await advanceSandbox(db, customerId, at(plan.approvalT));

      const tap = at(plan.approvalT) + 45_000;
      const [first, second] = await Promise.all([approveSandbox(db, customerId, runId, "Judge", tap), approveSandbox(db, customerId, runId, "Judge", tap + 1)]);
      expect(first).toMatchObject({ status: "approved", channel: "dashboard", approvedBy: "Judge" });
      expect(second.approvedAt).toEqual(first.approvedAt);

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

      // On the judge's clock: the run, then the ask, then their tap, then the calls and money it allowed.
      const approvedAt = new Date(tap).getTime();
      expect(first.approvedAt.getTime()).toBe(approvedAt);
      expect(run!.startedAt.getTime()).toBeGreaterThanOrEqual(START - 1000);
      expect(texts[0]!.createdAt.getTime()).toBeLessThan(approvedAt);
      const ownCalls = await db.select({ startedAt: calls.startedAt }).from(calls).where(sql`starts_with(${calls.id}, ${`${customerId}:`})`);
      expect(ownCalls.length).toBeGreaterThan(0);
      for (const call of ownCalls) expect(call.startedAt.getTime()).toBeGreaterThan(approvedAt);
      for (const { createdAt } of await db.select({ createdAt: ledger.createdAt }).from(ledger).where(eq(ledger.customerId, customerId))) {
        expect(createdAt.getTime()).toBeGreaterThan(approvedAt);
      }
      expect(run!.finishedAt!.getTime()).toBeLessThanOrEqual(at(END, tap - plan.approvalT / SANDBOX_SPEED) + 1);
    }));

  it("takes a tap before playback reaches the approval without moving the clock back or dating anything after its write", () =>
    withTestDb("sandbox_approve_early", async (db) => {
      await loadSeed(db, generateSeed());
      const customerId = "sandbox-e";
      const runId = await judge(db, customerId);
      const askT = plan.events.find(({ table, row }) => table === "approvals" && row?.status === "pending")!.t;
      await advanceSandbox(db, customerId, at(askT));
      // The Approve button shows from here, while the approval text has not played yet.
      expect(await db.$count(smsMessages, sql`starts_with(${smsMessages.id}, ${`${customerId}:`})`)).toBe(0);

      const tap = at(askT) + 100;
      expect(tap).toBeLessThan(at(plan.approvalT));
      await approveSandbox(db, customerId, runId, "Judge", tap);
      expect((await db.select().from(runs).where(eq(runs.id, runId)))[0]!.replay).toMatchObject({ pausedMs: 0, startedAt: new Date(START).toISOString() });

      // The next poll jumps to the approval: the text plays at once, dated no later than the tap.
      await advanceSandbox(db, customerId, tap + 1);
      const [text] = await db.select().from(smsMessages).where(sql`starts_with(${smsMessages.id}, ${`${customerId}:`})`);
      expect(text!.createdAt.getTime()).toBeLessThanOrEqual(tap);
      expect(await db.$count(ledger, eq(ledger.customerId, customerId))).toBe(0);

      // Then it plays on at its own pace: everything after the approval is dated after the tap, none of it in the future.
      const end = at(END) + 1;
      await advanceSandbox(db, customerId, end);
      const [run] = await db.select().from(runs).where(eq(runs.id, runId));
      expect(run!.status).toBe("success");
      expect(await totals(db, customerId)).toMatchObject({ refund: 1_260_606, savings: 1_831_932, fee: 927_761 });
      const ownCalls = await db.select({ startedAt: calls.startedAt }).from(calls).where(sql`starts_with(${calls.id}, ${`${customerId}:`})`);
      expect(ownCalls.length).toBeGreaterThan(0);
      for (const call of ownCalls) expect(call.startedAt.getTime()).toBeGreaterThan(tap);
      for (const { createdAt } of await db.select({ createdAt: ledger.createdAt }).from(ledger).where(eq(ledger.customerId, customerId))) {
        expect(createdAt.getTime()).toBeGreaterThan(tap);
        expect(createdAt.getTime()).toBeLessThanOrEqual(end);
      }
      expect(run!.finishedAt!.getTime()).toBeLessThanOrEqual(end);
    }));

  it("approves as the signed-in judge, and leaves the approval pending if the replay cannot resume", () =>
    withTestDb("sandbox_approve_atomic", async (db) => {
      await loadSeed(db, generateSeed());
      const user = await createSandboxUser(db, signUp("judge@x.example", "ip-1"));
      if (typeof user === "string") throw new Error(user);
      const runId = await startSandboxRun(db, user.customerId, START);
      await advanceSandbox(db, user.customerId, at(plan.approvalT));

      // Not the judge, or no judge: the same answer as a run that is not theirs.
      await expect(approveRun(db, runId, user.customerId)).rejects.toMatchObject({ status: 404 });
      await expect(approveRun(db, runId, user.customerId, "someone-else")).rejects.toMatchObject({ status: 404 });

      // A replay that cannot take the tap rolls the approval back with it.
      await db.execute(sql`update runs set replay = replay || '{"approvedAt": "2026-01-01T00:00:00.000Z"}' where id = ${runId}`);
      await expect(approveRun(db, runId, user.customerId, user.id)).rejects.toThrow(/not a sandbox replay waiting/);
      expect((await db.select().from(approvals).where(eq(approvals.runId, runId)))[0]).toMatchObject({ status: "pending", approvedBy: null });

      await db.execute(sql`update runs set replay = replay || '{"approvedAt": null}' where id = ${runId}`);
      expect(await approveRun(db, runId, user.customerId, user.id)).toMatchObject({ status: "approved", channel: "dashboard", approvedBy: "Judge Example" });
      expect((await db.select().from(runs).where(eq(runs.id, runId)))[0]!.replay).toMatchObject({ approvedAt: expect.any(String), pausedMs: expect.any(Number) });
    }));

  it("restarts cleanly while other tabs are polling", () =>
    withTestDb("sandbox_restart_race", async (db) => {
      await loadSeed(db, generateSeed());
      const customerId = "sandbox-r";
      await judge(db, customerId);
      await advanceSandbox(db, customerId, at(plan.approvalT));
      const again = START + 3_600_000;
      await Promise.all([advanceSandbox(db, customerId, at(1000, again)), restartSandbox(db, customerId, again), advanceSandbox(db, customerId, at(2000, again))]);
      expect(await db.$count(runs, eq(runs.customerId, customerId))).toBe(1);
      const [run] = await db.select().from(runs).where(eq(runs.customerId, customerId));
      expect(run!.replay).toMatchObject({ approvedAt: null, startedAt: new Date(again).toISOString() });
      // And it plays on to the approval again from there.
      await advanceSandbox(db, customerId, at(plan.approvalT, again));
      expect((await db.select().from(approvals).where(eq(approvals.runId, run!.id)))[0]!.status).toBe("pending");
    }));

  it("signs judges up onto their own copies, refuses a taken email, rolls back a failed sign-up and limits each address", () =>
    withTestDb("sandbox_signup", async (db) => {
      await loadSeed(db, generateSeed());
      const a = await createSandboxUser(db, signUp("a@x.example", "ip-a"));
      const b = await createSandboxUser(db, signUp("b@x.example", "ip-b"));
      if (typeof a === "string" || typeof b === "string") throw new Error("sign-up refused");
      expect(a.customerId).not.toBe(b.customerId);
      expect(a.customerId).not.toBe(CUSTOMER.id);
      expect(await db.$count(locations, eq(locations.customerId, a.customerId))).toBe(await db.$count(locations, eq(locations.customerId, CUSTOMER.id)));
      // Even the demo customer's own email gets a fresh copy, never Linda's rows.
      const linda = await createSandboxUser(db, signUp(CUSTOMER.contactEmail, "ip-l"));
      expect(typeof linda === "string" ? linda : linda.customerId).not.toBe(CUSTOMER.id);

      const customersBefore = await db.$count(customers);
      expect(await createSandboxUser(db, signUp("a@x.example", "ip-c"))).toBe("taken");
      // The user row fails after the copy: the copy goes too.
      await expect(createSandboxUser(db, { ...signUp("c@x.example", "ip-c"), name: null as never }, "sandbox-broken")).rejects.toThrow();
      expect(await db.$count(customers)).toBe(customersBefore);
      expect(await db.$count(locations, eq(locations.customerId, "sandbox-broken"))).toBe(0);

      // Five at once from one address: three get in, and another address still can.
      const burst = await Promise.all([1, 2, 3, 4, 5].map((n) => createSandboxUser(db, signUp(`burst-${n}@x.example`, "ip-burst"))));
      expect(burst.filter((result) => typeof result !== "string")).toHaveLength(SIGNUPS_PER_IP_PER_MINUTE);
      expect(burst.filter((result) => result === "busy")).toHaveLength(5 - SIGNUPS_PER_IP_PER_MINUTE);
      expect(typeof (await createSandboxUser(db, signUp("other@x.example", "ip-other")))).toBe("object");
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
