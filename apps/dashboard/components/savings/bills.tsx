"use client";

import { useState } from "react";
import { money, parseEvidence } from "../../lib/evidence.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { useLive } from "../../lib/use-live.tsx";
import { ButtonLink, EmptyState, PageHeader, StatusDot, Table } from "../ui/kit.tsx";
import { billDay, Page, PROVIDERS, SERVICES } from "./common.tsx";

type Bill = Snapshot["bills"][number];

// Only an uploaded PDF goes through the parser; a bill with no confidence came in as data, so the cell stays empty.
const confidence = (value: number | null) => (value === null ? "" : `${Math.round(value * 100)}%`);

/** Rows arrive ordered by site, then account, so grouping keeps that order. By id: two locations can share a name. */
export function bySite(bills: Bill[]) {
  const sites = new Map<string, Bill[]>();
  for (const bill of bills) sites.set(bill.locationId, [...(sites.get(bill.locationId) ?? []), bill]);
  return [...sites];
}

export type BillStatus = "Overcharged" | "Finding on account" | "OK";

/**
 * No over-claiming: a bill is "Overcharged" only when a finding's evidence names that bill as billed too much (meter or arithmetic).
 * Any other finding marks its account, not its bills, so those bills read "Finding on account".
 */
export function billStatuses(findings: Pick<Snapshot["findings"][number], "type" | "evidenceJson" | "accountId">[]) {
  const overcharged = new Set<string>();
  const flagged = new Set<string>();
  for (const finding of findings) {
    const evidence = parseEvidence(finding.type, finding.evidenceJson);
    if (evidence?.type === "meterMultiplierJump") for (const bill of evidence.detail.bills) if (bill.overbilledCents > 0) overcharged.add(bill.billId);
    // A bill whose total is above its own lines: the bills it names are the wrong ones.
    if (evidence?.type === "arithmeticCheck" && evidence.detail.differenceCents > 0) for (const id of (finding.evidenceJson as { billIds: string[] }).billIds) overcharged.add(id);
    if (finding.accountId) flagged.add(finding.accountId);
  }
  return (bill: Pick<Bill, "id" | "accountId">): BillStatus => (overcharged.has(bill.id) ? "Overcharged" : flagged.has(bill.accountId) ? "Finding on account" : "OK");
}

const STATUS_TONE = { Overcharged: "alert", "Finding on account": "plain", OK: "plain" } as const;

function FilterChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-9 cursor-pointer rounded-full border px-3 text-[15px] font-semibold whitespace-nowrap ${pressed ? "border-ink bg-ink text-sheet" : "border-line text-faded hover:border-faded hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function FilterGroup<T extends string>({ label, options, value, onChange, name }: { label: string; options: T[]; value: T | null; onChange: (v: T | null) => void; name: (v: T) => string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold text-faded">{label}</span>
      <FilterChip pressed={value === null} onClick={() => onChange(null)}>
        All
      </FilterChip>
      {options.map((option) => (
        <FilterChip key={option} pressed={value === option} onClick={() => onChange(value === option ? null : option)}>
          {name(option)}
        </FilterChip>
      ))}
    </div>
  );
}

export function Bills() {
  const { snapshot } = useLive();
  const all = snapshot?.bills ?? [];
  const accounts = new Set(all.map((bill) => bill.accountId)).size;
  const statusOf = billStatuses(snapshot?.findings ?? []);
  const [provider, setProvider] = useState<string | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [status, setStatus] = useState<BillStatus | null>(null);

  const providers = [...new Set(all.map((bill) => bill.provider))];
  const sites = bySite(all).map(([id, bills]) => ({ id, name: `${bills[0]!.site}, ${bills[0]!.city}` }));
  const statuses = (["Overcharged", "Finding on account", "OK"] as const).filter((s) => all.some((bill) => statusOf(bill) === s));
  const bills = all.filter((bill) => (!provider || bill.provider === provider) && (!site || bill.locationId === site) && (!status || statusOf(bill) === status));

  return (
    <Page>
      <PageHeader
        title="Bills"
        crumb={snapshot?.customer?.name}
        description={all.length > 0 ? `${all.length} bills across ${accounts} accounts, grouped by location.` : "Every bill we have, for each account and location."}
      />
      {snapshot && all.length === 0 && (
        <EmptyState title="No bills yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
          Bills appear here once you upload them or the agents download them from your provider&apos;s portal.
        </EmptyState>
      )}
      {all.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-3">
          <FilterGroup label="Provider" options={providers} value={provider} onChange={setProvider} name={(p) => PROVIDERS[p] ?? p} />
          {sites.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-faded">Store</span>
              <select
                value={site ?? ""}
                onChange={(event) => setSite(event.target.value || null)}
                className="min-h-9 cursor-pointer rounded-full border border-line bg-sheet px-3 text-[15px] font-semibold"
              >
                <option value="">All stores</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {statuses.length > 1 && <FilterGroup label="Status" options={statuses} value={status} onChange={setStatus} name={(s) => s} />}
        </div>
      )}
      {all.length > 0 && bills.length === 0 && <p className="text-faded">No bills match these filters.</p>}
      {bills.length > 0 && (
        <Table
          grouped
          head={[{ label: "Account" }, { label: "Billing period" }, { label: "Status" }, { label: "Total", numeric: true }, { label: "Parse confidence", numeric: true }]}
        >
          {bySite(bills).map(([locationId, siteBills]) => (
            <tbody key={locationId} data-testid="bills-site" aria-labelledby={`site-${locationId}`}>
              <tr>
                <th id={`site-${locationId}`} colSpan={5} scope="colgroup" className="border-t border-line bg-paper/60 px-4 py-2 text-left text-[15px] font-semibold">
                  {siteBills[0]!.site} <span className="font-normal text-faded">{siteBills[0]!.city}</span>
                </th>
              </tr>
              {siteBills.map((bill, i) => {
                const first = siteBills[i - 1]?.accountId !== bill.accountId;
                const billStatus = statusOf(bill);
                return (
                  <tr key={bill.id} data-bill={bill.id} data-status={billStatus}>
                    <td>
                      {first && (
                        <>
                          <span className="font-semibold">
                            {PROVIDERS[bill.provider]} {SERVICES[bill.serviceType]?.toLowerCase()}
                          </span>
                          <span className="ml-2 text-[13px] text-faded tabular-nums">Account {bill.accountNumber}</span>
                        </>
                      )}
                    </td>
                    <td className="tabular-nums">
                      {billDay(bill.periodStart)} to {billDay(bill.periodEnd)}
                    </td>
                    <td>
                      <StatusDot tone={STATUS_TONE[billStatus]}>{billStatus}</StatusDot>
                    </td>
                    <td className="text-right font-figure tabular-nums">{money(bill.totalCents)}</td>
                    <td className="text-right text-faded tabular-nums">{confidence(bill.parseConfidence)}</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </Table>
      )}
    </Page>
  );
}
