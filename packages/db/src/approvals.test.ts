import { describe, expect, it } from "vitest";
import { decideApproval } from "./approvals.ts";
import type { Db } from "./client.ts";
import { actions, approvals } from "./schema.ts";
import { seedRun, withTestDb } from "./test-db.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("db_approvals", fn));

const pendingBundle = async (db: Db) => {
  await seedRun(db, "run");
  await db.insert(actions).values({ id: "a", kind: "call", status: "queued" });
  await db.insert(approvals).values({ runId: "run", actionIds: ["a"], summary: "One bundle" });
};
const approve = { runId: "run", status: "approved", channel: "dashboard", approvedBy: "Owner" } as const;
const deny = { runId: "run", status: "denied", channel: "sms", approvedBy: "Phone" } as const;

describe("decideApproval", () => {
  test("records the decision and who made it", async (db) => {
    await pendingBundle(db);
    const row = await decideApproval(db, approve);
    expect(row).toMatchObject({ status: "approved", channel: "dashboard", approvedBy: "Owner" });
    expect(row.approvedAt).toBeInstanceOf(Date);
  });

  test("the first decision wins and a later one changes nothing", async (db) => {
    await pendingBundle(db);
    const first = await decideApproval(db, approve);
    expect(await decideApproval(db, deny)).toEqual(first);
  });

  test("two racing decisions leave one winner that both callers see", async (db) => {
    await pendingBundle(db);
    const [a, b] = await Promise.all([decideApproval(db, approve), decideApproval(db, deny)]);
    expect(a).toEqual(b);
    expect((await db.select().from(approvals))[0]).toEqual(a);
  });

  test("refuses a status that is not a decision and leaves the row pending", async (db) => {
    await pendingBundle(db);
    await expect(decideApproval(db, { ...approve, status: "pending" as "approved" })).rejects.toThrow(/Invalid/);
    expect((await db.select().from(approvals))[0]).toMatchObject({ status: "pending", approvedBy: null });
  });

  test("refuses a decision with no approver", async (db) => {
    await pendingBundle(db);
    await expect(decideApproval(db, { ...approve, approvedBy: "" })).rejects.toThrow(/who made it/);
  });

  test("throws when the run has no bundle", async (db) => {
    await expect(decideApproval(db, approve)).rejects.toThrow(/no approval bundle/);
  });
});
