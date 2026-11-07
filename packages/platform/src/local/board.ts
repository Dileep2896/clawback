import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { boardCards } from "@bill-fighter/db/schema";
import { asc, eq } from "drizzle-orm";
import type { Board } from "../types.ts";

export function createBoard(db: Db): Board {
  return {
    async create(card) {
      const [row] = await db.insert(boardCards).values(card).returning();
      return row!;
    },

    async move(cardId, status) {
      const [row] = await db.update(boardCards).set({ status }).where(eq(boardCards.id, cardId)).returning();
      if (!row) throw new Error(`Board card ${cardId} does not exist`);
      return row;
    },

    list: (runId) =>
      db.select().from(boardCards).where(eq(boardCards.runId, runId)).orderBy(asc(boardCards.updatedAt), asc(boardCards.id)),
  };
}

export default createBoard(sharedDb);
