"use client";

import type { ReactNode } from "react";
import { money, monthLabel } from "../../lib/evidence.ts";
import { amountOf } from "../../lib/now.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { PROVIDERS } from "../savings/common.tsx";
import { RULE_LABEL } from "../savings/findings.tsx";

const clock = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const providerName = (p: string) => PROVIDERS[p] ?? p;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-label text-faded">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="border-t border-line py-2 text-faded">{label}</dt>
          <dd className="border-t border-line py-2 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The bills grouped by account, in the order the snapshot keeps them (site, then account). */
function byAccount(bills: Snapshot["bills"]) {
  const groups = new Map<string, Snapshot["bills"]>();
  for (const bill of bills) groups.set(bill.accountId, [...(groups.get(bill.accountId) ?? []), bill]);
  return [...groups.values()];
}

/** What Intake read and what it concluded: the email, the customer it matched, the accounts and stores on file. */
export function IntakeView({ snapshot }: { snapshot: Snapshot }) {
  const { run, email, customer, bills } = snapshot;
  // shortcut: the accounts come from the bills on file, so an account with no bill is not counted. Add accounts to the snapshot if that matters.
  const accounts = byAccount(bills);
  const sites = [...new Set(bills.map((b) => `${b.site}, ${b.city}`))];
  const mail: [string, ReactNode][] = [];
  if (run?.trigger === "email") mail.push(["Arrived", clock.format(new Date(run.startedAt))]);
  if (email) mail.push(["From", email.from], ["Subject", email.subject]);
  return (
    <div data-testid="intake-view" className="grid gap-6">
      {mail.length > 0 && (
        <Section title="The email it read">
          <Facts rows={mail} />
        </Section>
      )}
      {customer && (
        <Section title="The customer it matched">
          <Facts rows={[["Customer", customer.name], ["Contact", `${customer.contactName} · ${customer.contactEmail}`]]} />
        </Section>
      )}
      {accounts.length > 0 && (
        <Section title={`${count(accounts.length, "account")} at ${count(sites.length, "store")}`}>
          <ul className="grid sm:grid-cols-2 sm:gap-x-6">
            {sites.map((site) => (
              <li key={site} className="border-t border-line py-2">
                {site}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** What the collector gathered: the portals, the bills per account and the usage per meter. */
export function CollectorView({ snapshot }: { snapshot: Snapshot }) {
  const { bills, usage } = snapshot;
  const accounts = byAccount(bills);
  const portals = [...new Set(bills.map((b) => providerName(b.provider)))];
  const siteOf = Object.fromEntries(bills.map((b) => [b.accountId, b.site]));
  return (
    <div data-testid="collector-view" className="grid gap-6">
      {portals.length > 0 && <p>Bills from the {portals.join(", ")} portals.</p>}
      {accounts.length > 0 && (
        <Section title={`${count(bills.length, "bill")} downloaded`}>
          <table className="w-full text-left tabular-nums">
            <thead className="text-label text-faded">
              <tr>
                <th className="py-2 font-normal">Account</th>
                <th className="py-2 font-normal">Bills</th>
                <th className="py-2 font-normal max-sm:hidden">Periods</th>
                <th className="py-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((group) => {
                const first = group[0]!;
                const periods = group.map((b) => b.periodEnd).sort();
                return (
                  <tr key={first.accountId} className="border-t border-line align-baseline">
                    <td className="py-2 pr-4">
                      {first.site} · {providerName(first.provider)}
                      <span className="block text-label text-faded">account {first.accountNumber}</span>
                    </td>
                    <td className="py-2 pr-4">{group.length}</td>
                    <td className="py-2 pr-4 max-sm:hidden">
                      {monthLabel(periods[0]!)} to {monthLabel(periods.at(-1)!)}
                    </td>
                    <td className="py-2 text-right">{money(group.reduce((sum, b) => sum + b.totalCents, 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}
      {usage.length > 0 && (
        <Section title={`Usage for ${count(usage.length, "meter")}`}>
          <table className="w-full text-left tabular-nums">
            <thead className="text-label text-faded">
              <tr>
                <th className="py-2 font-normal">Meter</th>
                <th className="py-2 font-normal">Readings</th>
                <th className="py-2 text-right font-normal">From – to</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.accountId} className="border-t border-line align-baseline">
                  <td className="py-2 pr-4">
                    {u.meterNumber ?? u.accountId}
                    {siteOf[u.accountId] && <span className="block text-label text-faded">{siteOf[u.accountId]}</span>}
                  </td>
                  <td className="py-2 pr-4">{u.intervals.toLocaleString("en-US")}</td>
                  <td className="py-2 text-right">{u.from && u.to ? `${day.format(new Date(u.from))} – ${day.format(new Date(u.to))}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

/** Every rule the audit runs, passed or with the findings it produced. Shown once this run's audit has run. */
export function AuditChecks({ snapshot }: { snapshot: Snapshot }) {
  const ran = snapshot.auditLog.some((r) => r.tool === "run_audit") || snapshot.boardCards.some((c) => c.agent === "auditor" && c.status === "done");
  if (!ran) return null;
  return (
    <Section title="The checks it ran">
      <ul data-testid="audit-checks" className="grid sm:grid-cols-2 sm:gap-x-6">
        {Object.entries(RULE_LABEL).map(([type, label]) => {
          const found = snapshot.findings.filter((f) => f.type === type).length;
          return (
            <li key={type} className="flex items-baseline justify-between gap-4 border-t border-line py-2">
              <span>{label}</span>
              <span className={found ? "text-money" : "text-faded"}>{found ? count(found, "finding") : "Passed"}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const DOCUMENT_KIND: Record<string, string> = { claim: "Rule 17.1 refund claim", plan_change: "Rule 12 rate change request", letter: "Cancellation letter" };
// Filing moves a claim or rate request to done; a cancellation letter is only drafted, as the call does the cancelling.
const FILED_KINDS = new Set(["claim", "plan_change"]);
const EXCERPT = 280;

/** The documents Filer drafted, each with its finding and the start of its wording. "Filed" only where the record says so. */
export function FilerView({ snapshot }: { snapshot: Snapshot }) {
  const findings = new Map(snapshot.findings.map((f) => [f.id, f]));
  const order = Object.keys(DOCUMENT_KIND);
  // Claims, then rate requests, then letters: the money first. A sort is stable, so each kind keeps its order.
  const documents = snapshot.actions
    .filter((a) => a.kind in DOCUMENT_KIND && a.findingId && findings.has(a.findingId))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  if (documents.length === 0) return null;
  return (
    <ul data-testid="filer-documents" className="grid gap-3">
      {documents.map((action) => {
        const finding = findings.get(action.findingId!)!;
        const wording = snapshot.letterWording[finding.id];
        const site = finding.accountId ? snapshot.findingSites[finding.accountId] : undefined;
        const filed = FILED_KINDS.has(action.kind) && action.status === "done";
        return (
          <li key={action.id} data-document={action.id} className="grid gap-2 rounded-card border border-line p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="text-label text-faded">
                {DOCUMENT_KIND[action.kind]}
                {site && ` · ${site}`}
              </p>
              <p className={`text-label ${filed ? "text-money" : "text-faded"}`}>{filed ? "Filed" : "Drafted"}</p>
            </div>
            <p className="font-semibold">{finding.title}</p>
            {wording && <p className="max-w-[72ch] text-faded">{wording.length > EXCERPT ? `${wording.slice(0, EXCERPT).trimEnd()}…` : wording}</p>}
            <p className="text-label tabular-nums text-faded">{amountOf(finding)}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** The Stripe invoice as recorded. A ledger invoice row is written only once the invoice is finalized, and it is never sent. */
export function Invoice({ snapshot }: { snapshot: Snapshot }) {
  const invoice = snapshot.ledger.findLast((row) => row.kind === "invoice");
  if (!invoice) return null;
  const rows: [string, ReactNode][] = [
    ["Invoice", invoice.externalId ?? "No Stripe id recorded"],
    ["Status", "Finalized in Stripe test mode, not sent"],
  ];
  if (invoice.description) rows.push(["Amounts", invoice.description]);
  return (
    <Section title="The invoice">
      <Facts rows={rows} />
    </Section>
  );
}

const CHECK_STATUS: Record<string, string> = { pending: "Waiting to run", running: "Running", fired: "Ran", failed: "Failed" };

/** What Monitor scheduled: the next bill check, if one is on file. */
export function MonitorView({ snapshot }: { snapshot: Snapshot }) {
  const next = snapshot.scheduledChecks.find((c) => c.status === "pending") ?? snapshot.scheduledChecks.at(-1);
  if (!next) return null;
  return (
    <Section title="What it scheduled">
      <Facts
        rows={[
          ["Next bill check", clock.format(new Date(next.runAt))],
          ["Status", CHECK_STATUS[next.status] ?? next.status],
          ["Watches for", "Next month's bills from every provider, audited again"],
        ]}
      />
    </Section>
  );
}
