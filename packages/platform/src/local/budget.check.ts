import assert from "node:assert/strict";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import adapter, { createBudget } from "./budget.ts";

export default async function check() {
  assert.equal(typeof adapter.add, "function");
  await withTestDb("check_budget", async (db) => {
    await seedRun(db, "run");
    const budget = createBudget(db);
    const { capUsd } = await budget.status("run");
    assert.deepEqual(await budget.add("run", capUsd / 2), { totalUsd: capUsd / 2, capUsd, over: false });
    assert.equal((await budget.add("run", capUsd)).over, true);
  });
}
