import { RUN_CARD_AGENT } from "@bill-fighter/shared/run-card";
import type { Snapshot } from "./snapshot.ts";

export type AgentState = "working" | "blocked" | "queued" | "done";

export type AgentRow = {
  agent: string;
  state: AgentState;
  /** What it is doing now, or the last thing it did: a card title, else its newest tool. */
  action: string;
  /** Seconds from its first to its last recorded row. Recorded times only, so a replay shows what the run showed. */
  elapsedSeconds: number;
  /** Its newest tool calls first, for the detail pane. */
  calls: Pick<Snapshot["auditLog"][number], "id" | "tool" | "createdAt">[];
  cards: Pick<Snapshot["boardCards"][number], "id" | "title" | "status">[];
};

// The CEO coordinates the others and the run card is the run itself; both show on the Board, so neither gets a row.
const NOT_AN_AGENT = new Set([RUN_CARD_AGENT, "ceo"]);

const ms = (iso: string) => new Date(iso).getTime();

/** One row per agent, in the order they first acted. Built only from board cards and audit rows already in the snapshot. */
export function agentRows({ boardCards, auditLog }: Pick<Snapshot, "boardCards" | "auditLog">): AgentRow[] {
  const times = new Map<string, number[]>();
  const note = (agent: string, at: string) => {
    if (!NOT_AN_AGENT.has(agent)) times.set(agent, [...(times.get(agent) ?? []), ms(at)]);
  };
  for (const card of boardCards) note(card.agent, card.updatedAt);
  for (const row of auditLog) note(row.agent, row.createdAt);

  return [...times]
    .sort(([a, x], [b, y]) => Math.min(...x) - Math.min(...y) || a.localeCompare(b))
    .map(([agent, stamps]): AgentRow => {
      const cards = boardCards.filter((card) => card.agent === agent);
      const calls = auditLog.filter((row) => row.agent === agent); // the snapshot sends audit rows newest first
      const active = cards.find((card) => card.status === "doing" || card.status === "blocked");
      const state: AgentState = cards.some((c) => c.status === "blocked")
        ? "blocked"
        : cards.some((c) => c.status === "doing")
          ? "working"
          : cards.some((c) => c.status === "todo")
            ? "queued"
            : "done";
      const latestCard = [...cards].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt))[0];
      return {
        agent,
        state,
        action: active?.title ?? latestCard?.title ?? calls[0]?.tool ?? "",
        elapsedSeconds: Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000),
        calls: calls.map(({ id, tool, createdAt }) => ({ id, tool, createdAt })),
        cards: cards.map(({ id, title, status }) => ({ id, title, status })),
      };
    });
}

/** 75 → "1:15". */
export const elapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
