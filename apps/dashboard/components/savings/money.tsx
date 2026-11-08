"use client";

import { money } from "../../lib/evidence.ts";
import { ledgerView } from "../../lib/ledger.ts";
import { actionState } from "../../lib/run-state.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { useLive } from "../../lib/use-live.tsx";
import { ButtonLink, Card, EmptyState, PageHeader, StatusDot, Table } from "../ui/kit.tsx";
import { NoAudit } from "../no-audit.tsx";
import { NOT_RECORDED, Page } from "./common.tsx";

/**
 * The customer's money arriving, one step per refund or savings row in the order the agents wrote them. Plotting only:
 * the points are running sums of ledger rows, and no figure on the page is read from here.
 */
export function moneyCurve(ledger: { kind: string; amountCents: number }[]) {
  let sum = 0;
  return [0, ...ledger.filter((row) => row.kind === "refund" || row.kind === "savings").map((row) => (sum += row.amountCents))];
}

export function AreaChart({ points, className = "mt-6 h-40" }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;
  const W = 640;
  const H = 160;
  const max = Math.max(...points) || 1;
  const xy = points.map((p, i) => [(i / points.length) * W, H - (p / max) * (H - 8)] as const);
  // A staircase: money lands at once, so each row is a step, not a slope. The last step runs on to the edge.
  const line = `${xy.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `H${x}V${y}`)).join("")}H${W}`;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`w-full overflow-visible ${className}`}>
      <path d={`${line}V${H}H0Z`} className="fill-money/10" />
      <path d={line} className="fill-none stroke-money" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2={W} y1={H} y2={H} className="stroke-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Line({ label, note, testId, children }: { label: string; note?: string; testId: string; children: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <dt className="min-w-0">
        <span className="font-semibold">{label}</span>
        {note && <span className="block text-[15px] text-faded">{note}</span>}
      </dt>
      <dd data-testid={testId} className="font-figure text-[1.75rem] leading-none whitespace-nowrap">
        {children}
      </dd>
    </div>
  );
}

// Claimed or due is not money yet: grey. Confirmed savings are green. Fee and invoice rows are plain ink.
const amountTone = (row: { kind: string; confirmed: boolean }) =>
  row.kind === "refund" || (row.kind === "savings" && !row.confirmed) ? "text-faded" : row.confirmed ? "text-money" : "";

export function Money() {
  return <MoneyView snapshot={useLive().snapshot} />;
}

export function MoneyView({ snapshot }: { snapshot: Snapshot | null | undefined }) {
  const view = ledgerView({ ledger: snapshot?.ledger ?? [], findings: snapshot?.findings ?? [], findingSites: snapshot?.findingSites ?? {} });
  const invoice = snapshot?.ledger.find((row) => row.kind === "invoice");
  const invoiceAction = snapshot?.actions.find((action) => action.kind === "invoice");
  const cardPayments = snapshot?.actions.filter((action) => action.kind === "card_pay") ?? [];

  if (snapshot && !snapshot.run) {
    return (
      <Page>
        <PageHeader title="Money" description="Every amount in your ledger, Clawback's invoice and card payments." />
        <NoAudit />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Money" crumb={snapshot?.customer?.name} description="Every amount in your ledger, Clawback's invoice and card payments." />
      <div className="grid gap-8">
        {snapshot && view.rows.length === 0 && (
          <EmptyState title="Nothing in your ledger yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
            Refunds, savings and Clawback&apos;s fee are recorded here once the agents file them.
          </EmptyState>
        )}
        {view.rows.length > 0 && (
          <>
            <div className="grid gap-6 min-[1000px]:grid-cols-[7fr_5fr]">
              <section aria-labelledby="keeps-title" className="rounded-card border border-line bg-sheet p-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="keeps-title" className="font-semibold text-faded">
                    You keep
                  </h2>
                  <span className="rounded-full border border-line px-3 py-0.5 text-[13px] font-semibold text-faded">All audits</span>
                </div>
                <p data-testid="money-keeps" className="mt-3 font-figure text-[3.5rem] leading-none text-money">
                  {view.customerKeepsCents === null ? NOT_RECORDED : money(view.customerKeepsCents)}
                </p>
                <AreaChart points={moneyCurve(snapshot?.ledger ?? [])} />
              </section>
              <section aria-labelledby="totals-title" className="rounded-card border border-line bg-sheet px-6 py-5">
                <h2 id="totals-title" className="font-semibold text-faded">
                  Totals
                </h2>
                <dl className="mt-1 divide-y divide-line">
                  <Line label="Refund claimed" note="Counts when the provider grants it" testId="money-refund">
                    {money(view.refundCents)}
                  </Line>
                  <Line label="Yearly savings" note={`${money(view.confirmedSavingsCents)} confirmed, ${money(view.dueSavingsCents)} due when granted`} testId="money-savings">
                    {money(view.annualSavingsCents)}
                  </Line>
                  <Line label="Clawback's fee" testId="money-fee">
                    {view.feeCents === null ? NOT_RECORDED : money(view.feeCents)}
                  </Line>
                </dl>
              </section>
            </div>

            <section aria-labelledby="ledger-title">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="ledger-title" className="text-lg font-semibold">
                  Ledger
                </h2>
                <p className="flex gap-5 text-[13px]">
                  <StatusDot tone="plain">Claimed, not money yet</StatusDot>
                  <StatusDot tone="money">Confirmed</StatusDot>
                </p>
              </div>
              <Table head={[{ label: "Item" }, { label: "Status" }, { label: "Amount", numeric: true }]} caption="Claimed and filed amounts count only when granted.">
                {view.rows.map((row) => (
                  <tr key={row.id} data-ledger-row={row.id} data-kind={row.kind}>
                    <td className="py-3!">
                      {row.site && <span className="block text-[13px] text-faded">{row.site}</span>}
                      <span className="font-semibold">{row.label}</span>
                    </td>
                    <td>
                      <StatusDot tone={row.confirmed ? "money" : "plain"}>{row.status ?? ""}</StatusDot>
                    </td>
                    <td className={`text-right font-figure tabular-nums ${amountTone(row)}`}>{money(row.amountCents)}</td>
                  </tr>
                ))}
              </Table>
            </section>
          </>
        )}

        <div className="grid gap-6 min-[1000px]:grid-cols-2">
        <Card title="Clawback's invoice">
          <p className="mb-4 inline-block rounded-full border border-line px-3 py-0.5 text-[13px] font-semibold text-faded">Stripe test mode</p>
          {invoice ? (
            <dl className="grid gap-3">
              <div>
                <dt className="text-faded">Invoice</dt>
                <dd data-testid="money-invoice-id" className="font-semibold tabular-nums">
                  {invoice.externalId}
                </dd>
              </div>
              <div>
                <dt className="text-faded">Amount</dt>
                <dd data-testid="money-invoice-amount" className="font-figure text-[2rem] leading-tight">
                  {money(invoice.amountCents)}
                </dd>
              </div>
              <div>
                <dt className="text-faded">Payment</dt>
                <dd data-testid="money-invoice-state" className="font-semibold">
                  Finalized in Stripe and not emailed. Clawback does not track payment of it yet.
                </dd>
                {invoice.description && <dd className="mt-1 text-faded">{invoice.description}</dd>}
              </div>
            </dl>
          ) : (
            <p data-testid="money-invoice-state" className="text-faded">
              {invoiceAction ? `Not created yet: ${actionState(invoiceAction, snapshot?.approval).toLowerCase()}.` : "Created after you approve the fixes."}
            </p>
          )}
        </Card>

        {cardPayments.length > 0 && (
          <Card title="Card payments">
            <ul className="grid gap-2">
              {cardPayments.map((action) => {
                const payload = action.payloadJson as { amountCents?: number; description?: string } | null;
                return (
                  <li key={action.id} data-card-payment={action.id} className="flex flex-wrap items-baseline justify-between gap-3">
                    <span>
                      <span className="font-semibold">{payload?.description ?? "Card payment"}</span>
                      <span className="block text-base text-faded">{actionState(action, snapshot?.approval)}</span>
                    </span>
                    {payload?.amountCents !== undefined && <span className="font-figure tabular-nums">{money(payload.amountCents)}</span>}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        </div>
      </div>
    </Page>
  );
}
