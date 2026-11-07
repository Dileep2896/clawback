import type { Db } from "@bill-fighter/db/client";
import { approvals, bills } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { expect, it } from "vitest";
import { callFacts } from "./facts.ts";
import { checkPlan } from "./sim/engine.ts";
import { SEED_PLAN, seedCallData, seedCallFacts } from "./sim/fixture.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) =>
  it(name, () =>
    withTestDb("voice_facts", async (db) => {
      await seedCallData(db, "action");
      await seedCallFacts(db, "action");
      await fn(db);
    }),
  );

const factsOf = async (db: Db, plan = SEED_PLAN) => callFacts(db, "action", plan, (await checkPlan(db, plan)).planned);

test("reads the company, holder, approval date and every planned account from the database", async (db) => {
  const facts = await factsOf(db);
  expect(facts).toMatchObject({ company: "Golden Gate Noodle Co.", holder: "Linda Park", approvedOn: "November 7, 2026", byOwner: true });
  expect(facts.accounts[0]).toEqual({ accountNumber: "BT-7001", address: "412 Clement St, San Francisco, CA 94118", latestBill: { amount: "$135.00", periodEnd: "2026-10-31" } });
  expect(facts.accounts.map((account) => account.accountNumber)).toEqual(expect.arrayContaining(SEED_PLAN.promoAccounts));
});

test("uses the customer's own date, not UTC, for a late evening approval", async (db) => {
  await db.update(approvals).set({ approvedAt: new Date("2026-11-08T05:00:00.000Z") });
  expect((await factsOf(db)).approvedOn).toBe("November 7, 2026");
});

test("gives the latest bill, and leaves out a bill that is not there", async (db) => {
  const [first] = await factsOf(db).then((facts) => facts.accounts);
  expect(first!.latestBill?.amount).toBe("$135.00");
  const [{ accountId }] = (await db.select({ accountId: bills.accountId }).from(bills)) as [{ accountId: string }];
  await db.insert(bills).values({ accountId, periodStart: "2026-09-01", periodEnd: "2026-09-30", totalCents: 1 });
  expect((await factsOf(db)).accounts.flatMap((account) => account.latestBill?.amount ?? [])).not.toContain("$0.01");
  await db.delete(bills);
  expect((await factsOf(db)).accounts[0]!.latestBill).toBeNull();
});

test("is not by the owner when a process approved", async (db) => {
  await db.update(approvals).set({ approvedBy: "run-local auto approval" });
  expect((await factsOf(db)).byOwner).toBe(false);
});

for (const status of ["pending", "denied"] as const) {
  test(`throws when the bundle is ${status}`, async (db) => {
    await db.update(approvals).set({ status });
    await expect(factsOf(db)).rejects.toThrow(/no approved bundle/);
  });
}

test("throws when the approved bundle is for another action", async (db) => {
  await db.update(approvals).set({ actionIds: ["other"] });
  await expect(factsOf(db)).rejects.toThrow(/no approved bundle/);
});

test("throws on an account not on file, and leaves out a promo account not on file", async (db) => {
  await expect(factsOf(db, { ...SEED_PLAN, accountNumber: "BT-0000" })).rejects.toThrow(/not on file/);
  const facts = await factsOf(db, { ...SEED_PLAN, promoAccounts: ["BC-0000"] });
  expect(facts.accounts.map((account) => account.accountNumber)).not.toContain("BC-0000");
});
