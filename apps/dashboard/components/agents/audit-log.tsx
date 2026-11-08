"use client";

import { agentName } from "../../lib/agents.ts";
import { auditCost } from "../../lib/ledger.ts";
import { toolWords } from "../../lib/tool-words.ts";
import { useLive } from "../../lib/use-live.tsx";

const clock = new Intl.DateTimeFormat("en-US", { timeStyle: "medium" });
const count = new Intl.NumberFormat("en-US");

/** Every tool call, in plain words with the tool name after it. Closed by default under the Now pane. */
export function AuditLog() {
  const { snapshot } = useLive();
  const rows = snapshot?.auditLog ?? [];
  const total = snapshot?.auditTotal ?? 0;
  if (rows.length === 0) return null;

  return (
    <details data-testid="audit-log" className="group shrink-0 rounded-card border border-line bg-sheet">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 text-faded hover:text-ink [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 transition-transform duration-200 ease-out group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span className="group-open:hidden">Show the full log, {count.format(total)} entries</span>
        <span className="hidden group-open:inline">Hide the log</span>
      </summary>
      {/* relative: the rows' sr-only text is absolutely positioned, and must stay inside this scroller or it stretches the page. */}
      <div className="relative max-h-[40dvh] overflow-y-auto border-t border-line px-5 pb-3">
        {total > rows.length && (
          <p data-testid="audit-capped" className="pt-3 text-label text-faded">
            Newest {count.format(rows.length)} of {count.format(total)}
          </p>
        )}
        <table className="w-full border-collapse">
          <thead className="sr-only">
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Agent</th>
              <th scope="col">What it did</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cost = auditCost(row.costUsd);
              return (
                <tr key={row.id} data-audit-row={row.id} className="border-b border-line align-baseline last:border-0">
                  <td className="py-2 pr-4 text-label whitespace-nowrap text-faded tabular-nums">{clock.format(new Date(row.createdAt))}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{agentName(row.agent)}</td>
                  <td className="py-2 pr-4 break-words">
                    {/* A narrow screen may break the tool name after an underscore, never inside a word. */}
                    {toolWords(row.tool)} <code className="font-mono text-caption text-faded">{row.tool.replaceAll("_", "_​")}</code>
                  </td>
                  <td data-testid="audit-cost" className="py-2 text-right text-label text-faded tabular-nums">
                    {cost ?? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">No cost recorded</span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
