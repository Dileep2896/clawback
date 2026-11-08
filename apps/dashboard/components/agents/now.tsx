"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { type AgentRow, agentName } from "../../lib/agents.ts";
import { money, monthLabel, parseEvidence } from "../../lib/evidence.ts";
import { amountOf, type Moment, nowMoment } from "../../lib/now.ts";
import { replayOf } from "../../lib/replay.ts";
import type { Snapshot } from "../../lib/snapshot.ts";
import { toolWords } from "../../lib/tool-words.ts";
import { useLive } from "../../lib/use-live.tsx";
import { BillSnippet } from "../evidence/bill-snippet.tsx";
import { EvidenceDrawer } from "../evidence/drawer.tsx";
import { KwhChart } from "../evidence/kwh-chart.tsx";
import { RateTable } from "../evidence/rate-table.tsx";
import { PROVIDERS } from "../savings/common.tsx";
import { AuditChecks, CollectorView, FilerView, IntakeView, Invoice, MonitorView } from "./agent-views.tsx";
import { Approval } from "./approval.tsx";
import { Call } from "./call.tsx";
import { Ledger } from "./ledger.tsx";

const clock = new Intl.DateTimeFormat("en-US", { timeStyle: "medium" });
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The newest bills, and how many there are: the collector's work at a glance. */
function Bills({ bills }: { bills: Snapshot["bills"] }) {
  const accounts = new Set(bills.map((b) => b.accountId)).size;
  const sites = new Set(bills.map((b) => b.locationId)).size;
  const newest = [...bills].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(0, 8);
  return (
    <div className="grid gap-4">
      <p className="text-faded">
        {plural(bills.length, "bill")} across {plural(accounts, "account")} at {plural(sites, "site")}. The newest:
      </p>
      <ul className="grid">
        {newest.map((bill) => (
          <li key={bill.id} className="flex items-baseline justify-between gap-4 border-t border-line py-2.5">
            <span className="min-w-0">
              {bill.site} · {PROVIDERS[bill.provider] ?? bill.provider}
              <span className="block text-label text-faded">
                {monthLabel(bill.periodEnd)} · account {bill.accountNumber}
              </span>
            </span>
            <span className="tabular-nums">{money(bill.totalCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The biggest finding at full size with its evidence, then the rest. Any finding opens its evidence. */
function Findings({ snapshot, openId, setOpenId }: { snapshot: Snapshot; openId: string | null; setOpenId: (id: string | null) => void }) {
  const sites = snapshot.findingSites;
  // Biggest first. A sort is stable, so ties keep their fixed order.
  const findings = [...snapshot.findings].sort((a, b) => b.refundCents - a.refundCents || b.annualSavingsCents - a.annualSavingsCents);
  const [lead, ...rest] = findings;
  const open = findings.find((f) => f.id === openId);
  if (!lead) return null;
  const evidence = parseEvidence(lead.type, lead.evidenceJson);
  const site = (f: Snapshot["findings"][number]) => (f.accountId ? sites[f.accountId] : undefined);

  return (
    <div className="grid gap-6">
      <article className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div className="min-w-0">
            {site(lead) && <p className="text-label text-faded">{site(lead)}</p>}
            <h3 className="text-title font-semibold">{lead.title}</h3>
          </div>
          <p className="font-figure text-body text-money tabular-nums">{amountOf(lead)}</p>
        </div>
        <p className="max-w-[72ch] text-faded">{lead.explanation}</p>
        {evidence?.type === "meterMultiplierJump" && <KwhChart detail={evidence.detail} />}
        {evidence?.type === "rateOptimization" && <RateTable detail={evidence.detail} />}
        {evidence && <BillSnippet evidence={evidence} />}
        <button type="button" data-finding={lead.id} aria-haspopup="dialog" onClick={() => setOpenId(lead.id)} className="min-h-9 cursor-pointer justify-self-start rounded-control border border-line px-3 hover:bg-paper">
          Open the evidence
        </button>
      </article>
      {rest.length > 0 && (
        <section aria-label="More findings" className="grid">
          <h3 className="pb-2 text-label text-faded">{plural(rest.length, "more finding")}</h3>
          <ul className="grid">
            {rest.map((finding) => (
              <li key={finding.id}>
                <button
                  type="button"
                  data-finding={finding.id}
                  aria-haspopup="dialog"
                  onClick={() => setOpenId(finding.id)}
                  className="flex w-full cursor-pointer items-baseline justify-between gap-4 border-t border-line py-2.5 text-left hover:bg-paper/60"
                >
                  <span className="min-w-0">
                    {finding.title}
                    {site(finding) && <span className="block text-label text-faded">{site(finding)}</span>}
                  </span>
                  <span className={`shrink-0 tabular-nums ${finding.refundCents + finding.annualSavingsCents > 0 ? "text-money" : "text-faded"}`}>{amountOf(finding)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {open && <EvidenceDrawer finding={open} site={site(open)} replay={replayOf(snapshot.run)} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** An agent with nothing bigger to show yet: what it has done, newest first. */
function Steps({ row }: { row: AgentRow | undefined }) {
  if (!row || row.calls.length === 0) return <p className="text-faded">{row?.state === "next" ? `${agentName(row.agent)} starts after the steps before it.` : "Starting the run."}</p>;
  return (
    <ol className="grid">
      {row.calls.slice(0, 12).map((call) => (
        <li key={call.id} className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 first:border-0">
          <span>{toolWords(call.tool)}</span>
          <span className="text-label text-faded tabular-nums">{clock.format(new Date(call.createdAt))}</span>
        </li>
      ))}
    </ol>
  );
}

const TITLES: Record<Moment, (s: Snapshot, row: AgentRow | undefined) => string> = {
  bills: (s, row) => (row?.state === "working" ? "Reading your bills" : "Your bills"),
  findings: (s) => (s.approval ? "What the agents found" : `${plural(s.findings.length, "finding")} so far`),
  approval: (s) => (s.approval?.status === "pending" ? "Waiting for you" : "Your approval"),
  call: (s) => (s.calls.some((c) => !c.endedAt) ? "Calling the provider" : "The call"),
  ledger: () => "The money",
  steps: (s, row) => (row ? agentName(row.agent) : "Starting"),
  intake: () => "The bill email",
  collector: () => "What it gathered",
  auditor: () => "The audit",
  filer: () => "The documents",
  monitor: () => "The next check",
};

/** One moment of the run at real size, chosen by lib/now.ts. Scrolls inside itself, so the page never does at desktop width. */
export function NowPane({ rows, picked, speech }: { rows: AgentRow[]; picked: string | null; speech: { speechFailed: boolean; silent: boolean } }) {
  const { snapshot } = useLive();
  const body = useRef<HTMLDivElement>(null);
  // Held here, not in Findings, so nowMoment can keep the findings up while their evidence is open.
  const [openId, setOpenId] = useState<string | null>(null);
  // An audit that removed the open finding closes its drawer, so the run's moments come back (render-time, same commit).
  if (openId && snapshot && !snapshot.findings.some((f) => f.id === openId)) setOpenId(null);
  const moment = snapshot?.run ? nowMoment(snapshot, picked, openId) : null;
  // The first moment is there on arrival; only a change of moment fades in (render-time state, so the same commit).
  const [entered, setEntered] = useState<Moment | "changed" | null>(null);
  if (moment && entered === null) setEntered(moment);
  else if (moment && entered !== "changed" && entered !== moment) setEntered("changed");
  // A new moment starts at its top; the call is left to useFollow, which has already scrolled it to its newest line.
  useEffect(() => {
    if (body.current && moment !== "call") body.current.scrollTop = 0;
  }, [moment]);
  if (!snapshot?.run || !moment) return null;
  // The agent this moment belongs to, else the first one at work, else the last one that worked.
  const owner = picked ?? { call: "negotiator", approval: "approver" }[moment as string];
  const row =
    rows.find((r) => r.agent === owner && r.state !== "next") ?? rows.find((r) => r.state === "working" || r.state === "waiting") ?? rows.findLast((r) => r.state !== "next");
  const views: Record<Moment, () => ReactNode> = {
    bills: () => <Bills bills={snapshot.bills} />,
    findings: () => <Findings snapshot={snapshot} openId={openId} setOpenId={setOpenId} />,
    approval: () => <Approval />,
    call: () => <Call {...speech} />,
    ledger: () => (
      <div className="grid gap-6">
        {picked === "finance" && <Invoice snapshot={snapshot} />}
        <Ledger />
      </div>
    ),
    steps: () => <Steps row={row} />,
    intake: () => <IntakeView snapshot={snapshot} />,
    collector: () => <CollectorView snapshot={snapshot} />,
    auditor: () => (
      <div className="grid gap-6">
        <AuditChecks snapshot={snapshot} />
        <Findings snapshot={snapshot} openId={openId} setOpenId={setOpenId} />
      </div>
    ),
    filer: () => <FilerView snapshot={snapshot} />,
    monitor: () => <MonitorView snapshot={snapshot} />,
  };

  return (
    <section aria-labelledby="now-title" data-moment={moment} className="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-sheet max-[1099px]:min-h-96">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-6 py-4">
        <h2 id="now-title" className="text-page font-semibold">
          {TITLES[moment](snapshot, row)}
        </h2>
        {row && row.state !== "next" && (
          <p className="text-label text-faded">
            {picked ? "Showing" : "Now"}: {agentName(row.agent)}
          </p>
        )}
      </div>
      {/* role="group" is what useFollow scrolls, so a streaming transcript stays at its newest line. Focusable for keyboard scrolling. */}
      <div ref={body} role="group" tabIndex={0} aria-labelledby="now-title" className="relative min-h-0 flex-1 overflow-y-auto p-6">
        <div key={`${picked}/${moment}`} className={`grid gap-6 ${entered === "changed" ? "now-enter" : ""}`}>
          {/* A picked agent's view opens with what it did, in plain words, then its own work. */}
          {picked && (
            <section aria-label={`What ${agentName(picked)} did`} className="grid gap-2">
              <h3 className="text-label text-faded">What {agentName(picked)} did</h3>
              <Steps row={rows.find((r) => r.agent === picked)} />
            </section>
          )}
          {!(picked && moment === "steps") && views[moment]()}
        </div>
      </div>
    </section>
  );
}
