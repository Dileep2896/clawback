"use client";

import { useLive } from "../../lib/use-live.tsx";
import { Panel } from "../panel.tsx";

// Stacked rows: at 22px, three columns in this panel would hold about 12 characters a line. Blocked work is still in progress, so it stays in Doing.
const ROWS = [
  { id: "todo", label: "To do", statuses: ["todo"] },
  { id: "doing", label: "Doing", statuses: ["doing", "blocked"] },
  { id: "done", label: "Done", statuses: ["done"] },
];

const agentName = (agent: string) => agent.charAt(0).toUpperCase() + agent.slice(1);

export function Board() {
  const { snapshot } = useLive();
  const cards = snapshot?.boardCards ?? [];

  return (
    <Panel title="Board">
      {cards.length === 0 && <p className="text-faded">No cards yet</p>}
      {cards.length > 0 && (
        <div className="grid gap-2">
          {ROWS.map((row) => {
            const inRow = cards.filter((card) => row.statuses.includes(card.status));
            return (
              <section key={row.id} data-board-row={row.id}>
                <h3 className="border-b-2 border-drum font-display text-[1.625rem] leading-tight font-semibold tabular-nums">
                  {row.label} ({inRow.length})
                </h3>
                <ul>
                  {inRow.map((card) => (
                    // Keyed inside its row, so a move mounts a new element and plays the arrival highlight.
                    <li key={card.id} data-card={card.id} className="board-card px-1 leading-tight">
                      <span className="font-semibold">{agentName(card.agent)}:</span> {card.title}
                      {card.status === "blocked" && (
                        <span data-testid="blocked-stamp" className="ml-2 inline-block rounded-[3px] border-2 border-stamp px-1 font-semibold text-stamp">
                          Blocked
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
