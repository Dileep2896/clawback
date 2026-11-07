import assert from "node:assert/strict";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import adapter, { createAudit } from "./audit.ts";

export default async function check() {
  assert.equal(typeof adapter.record, "function");
  await withTestDb("check_audit", async (db) => {
    await seedRun(db, "run");
    const audit = createAudit(db);
    await audit.record({ runId: "run", agent: "check", tool: "check", input: { a: 1 }, costUsd: 0.5 });
    const [entry] = await audit.list("run");
    assert.deepEqual(entry?.inputJson, { a: 1 });
    assert.equal(entry?.costUsd, 0.5);
  });
}
