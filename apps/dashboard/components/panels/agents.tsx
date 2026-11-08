"use client";

import { useState } from "react";
import { type AgentState, agentRows, elapsed } from "../../lib/agents.ts";
import { useLive } from "../../lib/use-live.tsx";
import { Panel } from "../panel.tsx";

const clock = new Intl.DateTimeFormat("en-US", { timeStyle: "medium" });
const name = (agent: string) => agent.charAt(0).toUpperCase() + agent.slice(1);

// Calm: only a working agent's dot moves, and not under reduced motion.
const DOT: Record<AgentState, string> = {
  working: "bg-agent animate-pulse motion-reduce:animate-none",
  blocked: "bg-alert",
  queued: "border-2 border-faded/60",
  done: "bg-faded/50",
};
const STATE_LABEL: Record<AgentState, string> = { working: "working", blocked: "blocked", queued: "queued", done: "done" };

/** One row per agent (dot, name, current action, elapsed) and a detail pane for the selected one. Follows the working agent until someone picks a row. */
export function Agents() {
  const { snapshot } = useLive();
  const rows = agentRows({ boardCards: snapshot?.boardCards ?? [], auditLog: snapshot?.auditLog ?? [] });
  const [picked, setPicked] = useState<string | null>(null);
  const live = rows.find((row) => row.state === "working" || row.state === "blocked") ?? rows.at(-1);
  const selected = rows.find((row) => row.agent === picked) ?? live;

  return (
    <Panel title="Agents">
      {rows.length === 0 && <p className="text-faded">No agents at work yet</p>}
      <ul className="grid">
        {rows.map((row) => (
          <li key={row.agent}>
            <button
              type="button"
              data-agent-row={row.agent}
              data-state={row.state}
              aria-pressed={row.agent === selected?.agent}
              onClick={() => setPicked(row.agent)}
              className={`grid w-full cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-control px-2 text-left leading-snug ${row.agent === selected?.agent ? "bg-paper" : "hover:bg-paper/60"}`}
            >
              <span aria-hidden="true" className={`size-3 rounded-full ${DOT[row.state]}`} />
              <span className="font-semibold">{name(row.agent)}</span>
              <span className="truncate text-faded" title={row.action}>
                {row.action}
              </span>
              <span className="text-faded tabular-nums">{elapsed(row.elapsedSeconds)}</span>
              <span className="sr-only">, {STATE_LABEL[row.state]}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <section data-testid="agent-detail" aria-label={`${name(selected.agent)} detail`} className="mt-2 border-t border-line pt-2 leading-snug">
          <p className="font-semibold">
            {name(selected.agent)}: <span className="font-normal">{selected.action}</span>
          </p>
          <ol className="mt-1 grid gap-0.5">
            {selected.calls.slice(0, 8).map((call) => (
              <li key={call.id} className="flex justify-between gap-3">
                <span className="break-all">{call.tool}</span>
                <span className="text-faded tabular-nums">{clock.format(new Date(call.createdAt))}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </Panel>
  );
}
