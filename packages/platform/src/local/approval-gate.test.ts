import { setTimeout as sleep } from "node:timers/promises";
import type { Db } from "@bill-fighter/db/client";
import { actions, approvals } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { describe, expect, it } from "vitest";
import { createApprovalGate } from "./approval-gate.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("approval_gate", fn));

const setup = async (db: Db) => {
  await seedRun(db, "run");
  await db.insert(actions).values(["inside", "outside"].map((id) => ({ id, kind: "call" as const, status: "queued" })));
  return createApprovalGate(db);
};
const decision = (status: "approved" | "denied") =>
  ({ runId: "run", status, channel: "dashboard", approvedBy: "Owner" }) as const;
const bundle = { runId: "run", actionIds: ["inside"], summary: "One bundle" };

describe("ApprovalGate", () => {
  test("creates one row for a bundle, even when calls race or repeat", async (db) => {
    const gate = await setup(db);
    const [a, b] = await Promise.all([gate.createBundle(bundle), gate.createBundle(bundle)]);
    expect(a.id).toBe(b.id);
    expect((await gate.createBundle({ ...bundle, actionIds: ["outside"] })).actionIds).toEqual(["inside"]);
    expect(await db.select().from(approvals)).toHaveLength(1);
    expect((await gate.get("run"))?.id).toBe(a.id);
  });

  test("get is null with no bundle", async (db) => {
    expect(await (await setup(db)).get("run")).toBeNull();
  });

  test("refuses an empty bundle and names unknown actions", async (db) => {
    const gate = await setup(db);
    await expect(gate.createBundle({ ...bundle, actionIds: [] })).rejects.toThrow(/at least one/);
    await expect(gate.createBundle({ ...bundle, actionIds: ["inside", "ghost"] })).rejects.toThrow(/ghost/);
    expect(await db.select().from(approvals)).toHaveLength(0);
  });

  test("an action outside an approved bundle stays blocked while one inside is released", async (db) => {
    const gate = await setup(db);
    await gate.createBundle(bundle);
    expect(await gate.isReleased("inside")).toBe(false);

    await gate.decide(decision("approved"));

    expect(await gate.isReleased("inside")).toBe(true);
    expect(await gate.waitForRelease("inside")).toBe(true);
    expect(await gate.isReleased("outside")).toBe(false);
    expect(await gate.waitForRelease("outside")).toBe(false);
  });

  test("a denied bundle releases nothing, and a later approval cannot overturn it", async (db) => {
    const gate = await setup(db);
    await gate.createBundle(bundle);
    await gate.decide(decision("denied"));
    expect((await gate.decide(decision("approved"))).status).toBe("denied");
    expect(await gate.isReleased("inside")).toBe(false);
    expect(await gate.waitForRelease("inside")).toBe(false);
  });

  test("waitForRelease waits while pending, then follows the decision", async (db) => {
    const gate = await setup(db);
    await gate.createBundle(bundle);
    let settled = false;
    const waiting = gate.waitForRelease("inside").finally(() => (settled = true));
    await sleep(700);
    expect(settled).toBe(false);
    await gate.decide(decision("approved"));
    expect(await waiting).toBe(true);
  });

  test("waitForRelease wakes up with false when the wait ends in a denial", async (db) => {
    const gate = await setup(db);
    await gate.createBundle(bundle);
    const waiting = gate.waitForRelease("inside");
    await gate.decide(decision("denied"));
    expect(await waiting).toBe(false);
  });

  test("waitForRelease rejects on abort, already aborted or mid wait", async (db) => {
    const gate = await setup(db);
    await gate.createBundle(bundle);
    await expect(gate.waitForRelease("inside", AbortSignal.abort())).rejects.toThrow();
    const controller = new AbortController();
    const waiting = gate.waitForRelease("inside", controller.signal);
    await sleep(100);
    controller.abort();
    await expect(waiting).rejects.toThrow();
  });
});
