import assert from "node:assert/strict";
import { actions } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import adapter, { createApprovalGate } from "./approval-gate.ts";

export default async function check() {
  assert.equal(typeof adapter.createBundle, "function");
  await withTestDb("check_approval_gate", async (db) => {
    await seedRun(db, "run");
    await db.insert(actions).values(["inside", "outside"].map((id) => ({ id, kind: "call" as const, status: "queued" })));
    const gate = createApprovalGate(db);
    await gate.createBundle({ runId: "run", actionIds: ["inside"], summary: "check" });
    await gate.decide({ runId: "run", status: "approved", channel: "dashboard", approvedBy: "check" });
    assert.equal(await gate.waitForRelease("inside"), true);
    assert.equal(await gate.isReleased("outside"), false);
  });
}
