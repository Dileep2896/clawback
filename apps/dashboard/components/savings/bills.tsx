"use client";

import { money } from "../../lib/evidence.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { useLive } from "../../lib/use-live.tsx";
import { ButtonLink, EmptyState, PageHeader, Table } from "../ui/kit.tsx";
import { billDay, Page, PROVIDERS, SERVICES } from "./common.tsx";

type Bill = Snapshot["bills"][number];

// Only an uploaded PDF goes through the parser; a bill with no confidence came in as data, so the cell stays empty.
const confidence = (value: number | null) => (value === null ? "" : `${Math.round(value * 100)}%`);

/** Rows arrive ordered by site, then account, so grouping keeps that order. */
function bySite(bills: Bill[]) {
  const sites = new Map<string, Bill[]>();
  for (const bill of bills) sites.set(bill.site, [...(sites.get(bill.site) ?? []), bill]);
  return [...sites];
}

export function Bills() {
  const { snapshot } = useLive();
  const bills = snapshot?.bills ?? [];
  const accounts = new Set(bills.map((bill) => bill.accountId)).size;

  return (
    <Page>
      <PageHeader
        title="Bills"
        description={bills.length > 0 ? `${bills.length} bills across ${accounts} accounts, grouped by location.` : "Every bill we have, for each account and location."}
      />
      {snapshot && bills.length === 0 && (
        <EmptyState title="No bills yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
          Bills appear here once you upload them or the agents download them from your provider&apos;s portal.
        </EmptyState>
      )}
      <div className="grid gap-10">
        {bySite(bills).map(([site, siteBills]) => (
          <section key={site} data-testid="bills-site" aria-labelledby={`site-${site}`}>
            <h2 id={`site-${site}`} className="mb-3 text-[1.75rem] leading-tight font-semibold">
              {site} <span className="text-[1.125rem] font-normal text-faded">{siteBills[0]!.city}</span>
            </h2>
            <Table
              head={[
                { label: "Account" },
                { label: "Billing period" },
                { label: "Total", numeric: true },
                { label: "Parse confidence", numeric: true },
              ]}
            >
              {siteBills.map((bill, i) => {
                const first = siteBills[i - 1]?.accountId !== bill.accountId;
                return (
                  <tr key={bill.id} data-bill={bill.id}>
                    {first && (
                      <td rowSpan={siteBills.filter((other) => other.accountId === bill.accountId).length} className="align-top">
                        <span className="font-semibold">
                          {PROVIDERS[bill.provider]} {SERVICES[bill.serviceType]?.toLowerCase()}
                        </span>
                        <span className="block text-base text-faded tabular-nums">Account {bill.accountNumber}</span>
                      </td>
                    )}
                    <td className="tabular-nums">
                      {billDay(bill.periodStart)} to {billDay(bill.periodEnd)}
                    </td>
                    <td className="text-right font-figure tabular-nums">{money(bill.totalCents)}</td>
                    <td className="text-right tabular-nums">{confidence(bill.parseConfidence)}</td>
                  </tr>
                );
              })}
            </Table>
          </section>
        ))}
      </div>
    </Page>
  );
}
