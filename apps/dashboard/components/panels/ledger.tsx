"use client";

import { money } from "../../lib/evidence.ts";
import { ledgerView } from "../../lib/ledger.ts";
import { useLive } from "../../lib/use-live.tsx";
import { Panel } from "../panel.tsx";

const NOT_RECORDED = "Not recorded yet";

function Total({ label, testId, big, children }: { label: string; testId: string; big?: boolean; children: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={big ? "font-semibold" : undefined}>{label}</dt>
      <dd data-testid={testId} className={`text-right font-semibold tabular-nums ${big ? "font-display text-[2.125rem] leading-tight" : ""}`}>
        {children}
      </dd>
    </div>
  );
}

function SavingsSplit({ label, testId, cents }: { label: string; testId: string; cents: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pl-4 text-faded">
      <dt>{label}</dt>
      <dd data-testid={testId} className="tabular-nums">
        {money(cents)}
      </dd>
    </div>
  );
}

export function Ledger() {
  const { snapshot } = useLive();
  const view = ledgerView({ ledger: snapshot?.ledger ?? [], findings: snapshot?.findings ?? [], findingSites: snapshot?.findingSites ?? {} });

  return (
    <Panel title="Ledger">
      {view.rows.length === 0 ? (
        <p className="text-faded">No ledger rows yet</p>
      ) : (
        <>
          <dl className="leading-snug">
            <Total label="Refund, claimed" testId="ledger-refund">
              {money(view.refundCents)}
            </Total>
            <Total label="Yearly savings" testId="ledger-savings">
              {money(view.annualSavingsCents)}
            </Total>
            {view.confirmedSavingsCents > 0 && <SavingsSplit label="Confirmed" testId="ledger-savings-confirmed" cents={view.confirmedSavingsCents} />}
            {view.dueSavingsCents > 0 && <SavingsSplit label="Due when granted" testId="ledger-savings-due" cents={view.dueSavingsCents} />}
            <Total label="Our fee" testId="ledger-fee">
              {view.feeCents === null ? NOT_RECORDED : money(view.feeCents)}
            </Total>
            <Total label="Customer keeps" testId="ledger-keeps" big>
              {view.customerKeepsCents === null ? NOT_RECORDED : money(view.customerKeepsCents)}
            </Total>
          </dl>
          <p data-testid="ledger-note" className="mt-1 leading-snug text-faded">
            Claimed and filed amounts count only when granted.
          </p>
          <ul className="mt-3 grid gap-2 border-t-2 border-faded pt-3">
            {view.rows.map((row) => (
              <li key={row.id} data-ledger-row={row.id} data-kind={row.kind} className="leading-snug">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">
                    {row.site && <span className="block text-faded">{row.site}</span>}
                    {row.label}
                  </span>
                  <span className="font-semibold tabular-nums">{money(row.amountCents)}</span>
                </div>
                {row.status && <span className="block text-faded">{row.status}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
