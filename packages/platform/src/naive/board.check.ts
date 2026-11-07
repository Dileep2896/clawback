import assert from "node:assert/strict";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import adapter, { createBoard } from "./board.ts";

/** Our board_cards stay the record; every write is handed to the naïve mirror. The mirror itself is in mirror.test.ts. */
export default async function check() {
  assert.equal(typeof adapter.create, "function");
  await withTestDb("check_naive_board", async (db) => {
    await seedRun(db, "run");
    const mirrored: string[] = [];
    const board = createBoard(db, async (card) => {
      mirrored.push(card.status);
    });
    const card = await board.create({ runId: "run", agent: "clawback-check", title: "check" });
    await board.move(card.id, "done");
    assert.deepEqual((await board.list("run")).map((row) => [row.agent, row.status]), [["check", "done"]]);
    assert.deepEqual(mirrored, ["todo", "done"]);
  });
}
