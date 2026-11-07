import { type NaiveApi, naiveApi } from "./runtime-http.ts";

// shortcut: the board owner is module state set by the runtime when a run starts, so the mirror only works in the
// run's own process, one run at a time (the demo rule). Upgrade to a lookup by run if runs ever overlap.
let boardOwner: string | null = null;
export const setBoardOwner = (agentId: string | null) => {
  boardOwner = agentId;
};

const NOTE_DONE = "Done in Clawback; the card in our own board_cards is the record.";

/**
 * Copies one of our cards onto the coordinator's naïve board, unassigned so it wakes nobody. The card key is our card
 * id, so a repeat POST answers the same naïve card. Never throws: the mirror is for the naïve console, not the demo.
 */
export async function mirrorCard(card: { id: string; title: string; status: string; agent: string }, api: NaiveApi = naiveApi) {
  if (!boardOwner) return;
  const board = `/boards/${boardOwner}/cards`;
  try {
    const mirrored = await api<{ id: string }>(board, {
      method: "POST",
      body: { key: card.id, title: card.title.slice(0, 200), body: `Member: ${card.agent}` },
    });
    // naïve refuses done without a note (409 missing_note), and Board.move passes only a status.
    await api(`${board}/${mirrored.id}`, { method: "PATCH", body: { status: card.status, ...(card.status === "done" ? { note: NOTE_DONE } : {}) } });
  } catch (error) {
    console.warn(`naïve board mirror failed for card ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
