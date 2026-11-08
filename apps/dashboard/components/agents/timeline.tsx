"use client";

import { type AgentRow, type AgentState, agentName, elapsed } from "../../lib/agents.ts";

// One meaning per colour. Only a working agent's dot moves, and not under reduced motion.
const DOT: Record<AgentState, string> = {
  working: "bg-agent animate-pulse motion-reduce:animate-none",
  waiting: "bg-warn",
  failed: "bg-alert",
  done: "bg-money",
  next: "border border-faded/60",
};
const STATE_LABEL: Record<AgentState, string> = { working: "working", waiting: "waiting for you", failed: "stopped", done: "done", next: "up next" };

function Row({ row, picked, onPick }: { row: AgentRow; picked: boolean; onPick: () => void }) {
  const next = row.state === "next";
  return (
    <li>
      <button
        type="button"
        data-agent-row={row.agent}
        data-state={row.state}
        aria-pressed={picked}
        disabled={next}
        onClick={onPick}
        className={`grid w-full grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-x-3 rounded-control px-3 py-2.5 text-left transition-colors duration-200 ease-out enabled:cursor-pointer ${picked ? "bg-paper shadow-[inset_0_0_0_1px_var(--line)]" : "enabled:hover:bg-paper/60"}`}
      >
        <span aria-hidden="true" className={`mt-1.5 size-2 rounded-full ${DOT[row.state]}`} />
        <span className="min-w-0">
          <span className={`block font-semibold ${next ? "text-faded" : ""}`}>{agentName(row.agent)}</span>
          {/* Wraps, never clipped: the plain-words actions are short, and a long one gets a third line rather than an ellipsis. */}
          <span data-agent-action className={`block text-label break-words ${row.state === "waiting" ? "text-warn" : "text-faded"}`}>
            {next ? "Up next" : row.state === "waiting" ? "Waiting for your approval" : row.action}
          </span>
        </span>
        <span className="text-label text-faded tabular-nums">{next ? "" : elapsed(row.elapsedSeconds)}</span>
        <span className="sr-only">, {STATE_LABEL[row.state]}</span>
      </button>
    </li>
  );
}

/** The run as one story: the CEO heading the agents in run order. Picking a row pins the Now pane to it. */
export function Timeline({ ceo, rows, picked, onPick }: { ceo: AgentRow; rows: AgentRow[]; picked: string | null; onPick: (agent: string | null) => void }) {
  return (
    <section aria-labelledby="timeline-title" className="flex min-h-0 flex-col rounded-card border border-line bg-sheet">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id="timeline-title" className="text-title font-semibold">
            CEO
          </h2>
          <p data-testid="ceo-action" className="text-label break-words text-faded">
            {ceo.state === "next" ? "Ready to start" : "Hands each step to an agent and checks it is done"}
          </p>
        </div>
        {picked && (
          <button type="button" onClick={() => onPick(null)} className="min-h-7 cursor-pointer rounded-control border border-line px-2.5 text-label text-faded hover:text-ink">
            Follow live
          </button>
        )}
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.map((row) => (
          <Row key={row.agent} row={row} picked={row.agent === picked} onPick={() => onPick(row.agent === picked ? null : row.agent)} />
        ))}
      </ol>
    </section>
  );
}
