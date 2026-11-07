"use client";

import { auditCost } from "../../lib/ledger.ts";
import { useLive } from "../../lib/use-live.tsx";
import { Panel } from "../panel.tsx";

const clock = new Intl.DateTimeFormat("en-US", { timeStyle: "medium" });
const count = new Intl.NumberFormat("en-US");

export function AuditLog() {
  const { snapshot } = useLive();
  const rows = snapshot?.auditLog ?? [];
  const total = snapshot?.auditTotal ?? 0;

  return (
    <Panel title="Audit log">
      {rows.length === 0 && <p className="text-faded">No tool calls yet</p>}
      {total > rows.length && (
        <p data-testid="audit-capped" className="mb-2 text-faded">
          Newest {count.format(rows.length)} of {count.format(total)}
        </p>
      )}
      {rows.length > 0 && (
        <table className="w-full border-collapse leading-snug">
          <thead>
            <tr className="border-b-2 border-faded text-left text-faded">
              <th scope="col" className="pr-3 font-semibold">
                Time
              </th>
              <th scope="col" className="pr-3 font-semibold">
                Agent and tool
              </th>
              <th scope="col" className="text-right font-semibold">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cost = auditCost(row.costUsd);
              return (
                <tr key={row.id} data-audit-row={row.id} className="border-b border-faded/40 align-top">
                  <td className="pr-3 whitespace-nowrap tabular-nums">{clock.format(new Date(row.createdAt))}</td>
                  <td className="pr-3 break-all">
                    <span className="block font-semibold">{row.agent}</span>
                    {row.tool}
                  </td>
                  <td data-testid="audit-cost" className="text-right tabular-nums">
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
      )}
    </Panel>
  );
}
