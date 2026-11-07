import assert from "node:assert/strict";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import adapter, { createBoard } from "./board.ts";

export default async function check() {
  assert.equal(typeof adapter.create, "function");
  await withTestDb("check_board", async (db) => {
    await seedRun(db, "run");
    const board = createBoard(db);
    const card = await board.create({ runId: "run", agent: "check", title: "check" });
    await board.move(card.id, "done");
    assert.deepEqual((await board.list("run")).map((row) => row.status), ["done"]);
  });
}
