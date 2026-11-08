import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { createBoard as createLocalBoard } from "../local/board.ts";
import type { Board } from "../types.ts";

/**
 * Our board_cards are the only record. Nothing is copied to naïve's board: a card that reaches done or blocked there
 * starts a board-digest session of the coordinator, outside the run.
 */
export function createBoard(db: Db): Board {
  const local = createLocalBoard(db);
  return {
    // The CEO knows members by their naïve names (clawback-<agent>); the dashboard shows roster names (seen live).
    create: (card) => local.create({ ...card, agent: card.agent.replace(/^clawback-/, "") }),
    move: local.move,
    list: local.list,
  };
}

export default createBoard(sharedDb);
