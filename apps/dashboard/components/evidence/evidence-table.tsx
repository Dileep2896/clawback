import type { ReactNode } from "react";

/** A bill-style table. Scrolls sideways by itself, so a narrow screen never scrolls the page. */
export function EvidenceTable({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-action">
            {head.map((label, i) => (
              <th key={label} scope="col" className={`px-2 py-1 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-faded">
              {row.map((cell, i) => (
                <td key={i} className={`px-2 py-1 ${i === 0 ? "text-left" : "text-right"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Labelled facts from a finding's evidence. */
export function Facts({ facts }: { facts: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-faded">{label}</dt>
          <dd className="font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
