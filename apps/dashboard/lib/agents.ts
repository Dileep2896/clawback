import { RUN_CARD_AGENT } from "@bill-fighter/shared/run-card";
import type { Snapshot } from "./snapshot.ts";
import { toolWords } from "./tool-words.ts";

/** working = blue pulse, waiting = on the owner (amber), failed = coral, done = lime, next = not started yet. */
export type AgentState = "working" | "waiting" | "failed" | "done" | "next";

export type AgentRow = {
  agent: string;
  state: AgentState;
  /** What it is doing now, or the last thing it did, in plain words. Empty for an agent that has not started. */
  action: string;
  /** Seconds from its first to its last recorded row. Recorded times only, so a replay shows what the run showed. */
  elapsedSeconds: number;
  /** Its newest tool calls first. */
  calls: Pick<Snapshot["auditLog"][number], "id" | "tool" | "createdAt">[];
};

// The order a run goes in: the filer drafts letters before the approval and files after it. An agent not listed goes last.
export const ROSTER = ["intake", "collector", "auditor", "filer", "approver", "negotiator", "finance", "monitor"];
// The CEO coordinates the others and heads the timeline; the run card is the run itself.
const NOT_A_ROW = new Set([RUN_CARD_AGENT, "ceo"]);

const ms = (iso: string) => new Date(iso).getTime();
const rank = (agent: string) => (ROSTER.includes(agent) ? ROSTER.indexOf(agent) : ROSTER.length);

type Input = Pick<Snapshot, "boardCards" | "auditLog"> & { approvalPending?: boolean; runActive?: boolean };

function rowOf(agent: string, { boardCards, auditLog, approvalPending = false, runActive = true }: Input): AgentRow {
  const cards = boardCards.filter((card) => card.agent === agent);
  const calls = auditLog.filter((row) => row.agent === agent); // the snapshot sends audit rows newest first
  const stamps = [...cards.map((c) => ms(c.updatedAt)), ...calls.map((c) => ms(c.createdAt))];
  const active = cards.find((card) => card.status === "doing" || card.status === "blocked");
  const latestCard = [...cards].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt))[0];
  const started = calls.length > 0 || cards.some((c) => c.status !== "todo");
  // A run that stopped leaves its open cards open: nobody is working on them any more.
  const working = cards.some((c) => c.status === "doing");
  const state: AgentState = !started
    ? "next"
    : cards.some((c) => c.status === "blocked") || (working && !runActive)
      ? "failed"
      : agent === "approver" && approvalPending
        ? "waiting"
        : working
          ? "working"
          : "done";
  return {
    agent,
    state,
    action: state === "next" ? "" : (active?.title ?? latestCard?.title ?? (calls[0] ? toolWords(calls[0].tool) : "")),
    elapsedSeconds: stamps.length > 1 ? Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000) : 0,
    calls: calls.map(({ id, tool, createdAt }) => ({ id, tool, createdAt })),
  };
}

/** Every agent in run order, including the ones still to come. Built only from board cards and audit rows already in the snapshot. */
export function agentRows(input: Input): AgentRow[] {
  const seen = new Set([...input.boardCards.map((c) => c.agent), ...input.auditLog.map((r) => r.agent)].filter((a) => !NOT_A_ROW.has(a)));
  const agents = [...new Set([...ROSTER, ...seen])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return agents.map((agent) => rowOf(agent, input));
}

/** The CEO's row for the timeline header: what it is coordinating, from its newest card or call. */
export const ceoRow = (input: Input) => rowOf("ceo", input);

export const agentName = (agent: string) => (agent === "ceo" ? "CEO" : agent.charAt(0).toUpperCase() + agent.slice(1));

/** 75 → "1:15". */
export const elapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
