"use client";

import { money } from "../../lib/evidence.ts";
import { ledgerView } from "../../lib/ledger.ts";
import { useLive } from "../../lib/use-live.tsx";
import { CountUp } from "./count-up.tsx";

const NOT_RECORDED = "Not recorded yet";

function Total({ label, testId, cents, keeps }: { label: string; testId: string; cents: number | null; keeps?: boolean }) {
  return (
    <div className={`grid gap-1 rounded-card border border-line p-4 ${keeps ? "bg-paper" : ""}`}>
      <dt className="text-label text-faded">{label}</dt>
      <dd>
        {cents === null ? (
          <span data-testid={testId} className="text-faded">
            {NOT_RECORDED}
          </span>
        ) : (
          <CountUp cents={cents} testId={testId} className={`font-figure text-page ${keeps ? "text-money" : ""}`} />
        )}
      </dd>
    </div>
  );
}

/** The money at the end of the run: totals counting up, then every ledger row. Lime only for what the owner keeps and confirmed amounts. */
export function Ledger() {
  const { snapshot } = useLive();
  const view = ledgerView({ ledger: snapshot?.ledger ?? [], findings: snapshot?.findings ?? [], findingSites: snapshot?.findingSites ?? {} });

  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Total label="Refund, claimed" testId="ledger-refund" cents={view.refundCents} />
        <Total label="Yearly savings" testId="ledger-savings" cents={view.annualSavingsCents} />
        <Total label="Our fee" testId="ledger-fee" cents={view.feeCents} />
        <Total label="You keep" testId="ledger-keeps" cents={view.customerKeepsCents} keeps />
      </dl>
      {(view.confirmedSavingsCents > 0 || view.dueSavingsCents > 0) && (
        <p className="text-label text-faded tabular-nums">
          Yearly savings:{" "}
          {view.confirmedSavingsCents > 0 && (
            <>
              <span data-testid="ledger-savings-confirmed" className="text-money">
                {money(view.confirmedSavingsCents)}
              </span>{" "}
              confirmed
            </>
          )}
          {view.confirmedSavingsCents > 0 && view.dueSavingsCents > 0 && ", "}
          {view.dueSavingsCents > 0 && (
            <>
              <span data-testid="ledger-savings-due">{money(view.dueSavingsCents)}</span> due when granted
            </>
          )}
        </p>
      )}
      <p data-testid="ledger-note" className="text-label text-faded">
        Claimed and filed amounts count only when granted.
      </p>
      <ul className="grid">
        {view.rows.map((row) => (
          <li key={row.id} data-ledger-row={row.id} data-kind={row.kind} className="ledger-row flex items-baseline justify-between gap-4 border-t border-line py-2.5">
            <span className="min-w-0">
              {row.label}
              {(row.site || row.status) && <span className="block text-label text-faded">{[row.site, row.status].filter(Boolean).join(" · ")}</span>}
            </span>
            <span className="tabular-nums">{money(row.amountCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
