import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { createBoard as createLocalBoard } from "../local/board.ts";
import type { Board } from "../types.ts";
import { mirrorCard } from "./mirror.ts";

/** Our board_cards stay the record the dashboard reads; each write is then copied to the naïve board. */
export function createBoard(db: Db, mirror: typeof mirrorCard = mirrorCard): Board {
  const local = createLocalBoard(db);
  return {
    async create(card) {
      // The CEO knows members by their naïve names (clawback-<agent>); the dashboard shows roster names (seen live).
      const row = await local.create({ ...card, agent: card.agent.replace(/^clawback-/, "") });
      await mirror(row);
      return row;
    },
    async move(cardId, status) {
      const row = await local.move(cardId, status);
      await mirror(row);
      return row;
    },
    list: local.list,
  };
}

export default createBoard(sharedDb);
