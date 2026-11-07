import type { Db } from "@bill-fighter/db/client";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { describe, expect, it } from "vitest";
import { createBoard } from "./board.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) => it(name, () => withTestDb("board", fn));

describe("Board", () => {
  test("creates a card, todo by default, and moves it", async (db) => {
    await seedRun(db, "run");
    const board = createBoard(db);
    const card = await board.create({ runId: "run", agent: "ceo", title: "Open plan" });
    expect(card.status).toBe("todo");
    const moved = await board.move(card.id, "doing");
    expect(moved.status).toBe("doing");
    expect(moved.updatedAt.getTime()).toBeGreaterThanOrEqual(card.updatedAt.getTime());
    expect(await board.list("run")).toEqual([moved]);
  });

  test("lists one run's cards, least recently updated first", async (db) => {
    await seedRun(db, "run");
    await seedRun(db, "other");
    const board = createBoard(db);
    const first = await board.create({ runId: "run", agent: "ceo", title: "First", status: "doing" });
    const second = await board.create({ runId: "run", agent: "auditor", title: "Second" });
    await board.create({ runId: "other", agent: "ceo", title: "Elsewhere" });
    expect((await board.list("run")).map((card) => card.id)).toEqual([first.id, second.id]);
    await board.move(first.id, "done");
    expect((await board.list("run")).map((card) => card.id)).toEqual([second.id, first.id]);
  });

  test("moving an unknown card throws", async (db) => {
    await expect(createBoard(db).move("ghost", "done")).rejects.toThrow(/ghost/);
  });
});
