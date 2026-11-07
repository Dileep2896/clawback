"use client";

import { money } from "../../lib/evidence.ts";
import { ledgerView } from "../../lib/ledger.ts";
import { actionState } from "../../lib/run-state.ts";
import { useLive } from "../../lib/use-live.tsx";
import { ButtonLink, Card, EmptyState, PageHeader, StatTile, Table } from "../ui/kit.tsx";
import { NOT_RECORDED, Page } from "./common.tsx";


export function Money() {
  const { snapshot } = useLive();
  const view = ledgerView({ ledger: snapshot?.ledger ?? [], findings: snapshot?.findings ?? [], findingSites: snapshot?.findingSites ?? {} });
  const invoice = snapshot?.ledger.find((row) => row.kind === "invoice");
  const invoiceAction = snapshot?.actions.find((action) => action.kind === "invoice");
  const cardPayments = snapshot?.actions.filter((action) => action.kind === "card_pay") ?? [];

  return (
    <Page>
      <PageHeader title="Money" description="Every amount in your ledger, Clawback's invoice and card payments." />
      {snapshot && view.rows.length === 0 ? (
        <EmptyState title="Nothing in your ledger yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
          Refunds, savings and Clawback&apos;s fee are recorded here once the agents file them.
        </EmptyState>
      ) : (
        <div className="grid gap-8">
          <div className="grid gap-4 sm:grid-cols-2 min-[1100px]:grid-cols-4">
            <StatTile label="Refund claimed" value={money(view.refundCents)} note="Counts when the provider grants it" testId="money-refund" />
            <StatTile
              label="Yearly savings"
              value={money(view.annualSavingsCents)}
              note={`${money(view.confirmedSavingsCents)} confirmed, ${money(view.dueSavingsCents)} due when granted`}
              testId="money-savings"
            />
            <StatTile label="Clawback's fee" value={view.feeCents === null ? NOT_RECORDED : money(view.feeCents)} testId="money-fee" />
            <StatTile label="You keep" value={view.customerKeepsCents === null ? NOT_RECORDED : money(view.customerKeepsCents)} tone="money" testId="money-keeps" />
          </div>

          <section aria-labelledby="ledger-title">
            <h2 id="ledger-title" className="mb-3 text-[1.75rem] leading-tight font-semibold">
              Ledger
            </h2>
            <Table head={[{ label: "Item" }, { label: "Status" }, { label: "Amount", numeric: true }]} caption="Claimed and filed amounts count only when granted.">
              {view.rows.map((row) => (
                <tr key={row.id} data-ledger-row={row.id} data-kind={row.kind}>
                  <td>
                    {row.site && <span className="block text-base text-faded">{row.site}</span>}
                    <span className="font-semibold">{row.label}</span>
                  </td>
                  <td className="text-faded">{row.status}</td>
                  <td className="text-right font-figure tabular-nums">{money(row.amountCents)}</td>
                </tr>
              ))}
            </Table>
          </section>

          <Card title="Clawback's invoice">
            <p className="mb-4 inline-block rounded-full border border-line px-3 py-0.5 text-base font-semibold text-faded">Stripe test mode</p>
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
      )}
    </Page>
  );
}
