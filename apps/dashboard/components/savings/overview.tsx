"use client";

import { money } from "../../lib/evidence.ts";
import { ledgerView } from "../../lib/ledger.ts";
import { STOPPED_TEXT, statusLabel } from "../../lib/run-state.ts";
import { APPROVAL_CHANNELS, useApprove } from "../../lib/use-approve.ts";
import { useLive } from "../../lib/use-live.tsx";
import { Button, ButtonLink, PageHeader, StatusDot } from "../ui/kit.tsx";
import { NoAudit } from "../no-audit.tsx";
import { NOT_RECORDED, Page, runDate } from "./common.tsx";
import { AreaChart, moneyCurve } from "./money.tsx";

function StatementLine({ label, note, testId, children }: { label: string; note?: string; testId: string; children: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-4">
      <dt className="min-w-0">
        <span className="font-semibold">{label}</span>
        {note && <span className="block text-faded">{note}</span>}
      </dt>
      <dd data-testid={testId} className="font-figure text-[2.5rem] leading-none whitespace-nowrap">
        {children}
      </dd>
    </div>
  );
}

/** What you keep against Clawback's fee, drawn to scale. Plotting only: both values come from ledgerView, nothing is worked out here. */
function SplitBar({ keepsCents, feeCents }: { keepsCents: number | null; feeCents: number | null }) {
  if (keepsCents === null || feeCents === null || keepsCents + feeCents <= 0) return null;
  const share = `${(keepsCents / (keepsCents + feeCents)) * 100}%`;
  return (
    <div aria-hidden="true" className="mt-8">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        <span className="rounded-l-full bg-money" style={{ width: share }} />
        <span className="flex-1 rounded-r-full bg-faded/35" />
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 text-faded">
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-money" />
          You keep
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-faded/35" />
          Clawback&apos;s fee
        </span>
      </div>
    </div>
  );
}

/** Only while the bundle waits for a decision: once decided it is one line in Latest audit, so the statement stays on screen. */
function ApprovalCard() {
  const { approval, replay, stopped, busy, failed, approve, canApprove } = useApprove();
  if (approval?.status !== "pending") return null;
  const count = `${approval.actionIds.length} ${approval.actionIds.length === 1 ? "action" : "actions"}, one approval`;

  return (
    <section
      data-testid="overview-approval"
      aria-labelledby="approval-title"
      className="rounded-card border border-warn bg-sheet p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-2 font-semibold text-warn">
            <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
            Needs you
          </p>
          <h2 id="approval-title" className="mt-1 text-[1.75rem] leading-tight font-semibold">
            Approval needed
          </h2>
          <p className="mt-1 text-faded">{count}. Nothing is sent to a provider until you approve.</p>
        </div>
        {canApprove && (
          <Button data-testid="overview-approve" disabled={busy} onClick={approve} className="min-h-14 px-10 text-[1.25rem]">
            {busy ? "Approving" : "Approve"}
          </Button>
        )}
      </div>
      {replay && <p className="mt-3 font-semibold text-warn">Waiting for the recorded reply</p>}
      {stopped && (
        <p role="alert" className="mt-3 font-semibold text-alert">
          {STOPPED_TEXT}
        </p>
      )}
      {failed && (
        <p role="alert" data-testid="overview-approve-error" className="mt-3 font-semibold text-alert">
          Approve failed. Try again.
        </p>
      )}
      <p data-testid="overview-approval-summary" className="mt-4 max-w-[80ch] border-t border-line pt-4 whitespace-pre-line text-faded">
        {approval.summary}
      </p>
    </section>
  );
}

export function Overview() {
  const { snapshot } = useLive();
  const approval = snapshot?.approval;
  const run = snapshot?.run;
  const view = ledgerView({ ledger: snapshot?.ledger ?? [], findings: snapshot?.findings ?? [], findingSites: snapshot?.findingSites ?? {} });

  if (snapshot && !run) {
    return (
      <Page>
        <PageHeader title="Overview" description="Money claimed, yearly savings and anything that needs your approval." />
        <NoAudit />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Overview"
        crumb={snapshot?.customer?.name}
        description={run ? `From your audit started ${runDate(run.startedAt)}.` : "Loading your latest audit."}
        actions={
          <ButtonLink href="/agents" variant="secondary">
            Watch your agents work
          </ButtonLink>
        }
      />

      <div className="grid gap-6">
        <ApprovalCard />

        <div className="grid gap-6 min-[1000px]:grid-cols-2">
          {/* The hero tile: what the owner keeps is core's figure, never worked out here. */}
          <section aria-labelledby="keeps-title" className="flex flex-col rounded-card border border-line bg-sheet p-8">
            <h2 id="keeps-title" className="font-semibold text-faded">
              You keep
            </h2>
            <p data-testid="overview-keeps" className="mt-3 font-figure text-[3.5rem] leading-none text-money sm:text-[4.5rem]">
              {view.customerKeepsCents === null ? NOT_RECORDED : money(view.customerKeepsCents)}
            </p>
            {view.refundCents > 0 && (
              <p className="mt-4 font-semibold text-money">
                + {money(view.refundCents)} refund claimed <span className="font-normal text-faded">across all audits</span>
              </p>
            )}
            <div className="mt-auto pt-6">
              <AreaChart points={moneyCurve(snapshot?.ledger ?? [])} className="h-24" />
              <SplitBar keepsCents={view.customerKeepsCents} feeCents={view.feeCents} />
            </div>
          </section>

          {/* Every line is a ledger sum. */}
          <section aria-labelledby="statement-title" className="rounded-card border border-line bg-sheet px-6 py-5">
            <h2 id="statement-title" className="font-semibold text-faded">
              Your statement
            </h2>
            <dl className="mt-1 divide-y divide-line">
              <StatementLine label="Refund claimed" note="Counts when the provider grants it" testId="overview-refund">
                {money(view.refundCents)}
              </StatementLine>
              <StatementLine label="Yearly savings" note="Lower bills, counted for one year" testId="overview-savings">
                {money(view.annualSavingsCents)}
              </StatementLine>
              <StatementLine label="Clawback's fee" note="A share of what we find, nothing up front" testId="overview-fee">
                {view.feeCents === null ? NOT_RECORDED : `− ${money(view.feeCents)}`}
              </StatementLine>
            </dl>
          </section>
        </div>

        <section aria-label="Latest audit" className="rounded-card border border-line bg-sheet px-6 py-5">
          {run ? (
            <div className="flex flex-wrap items-center gap-x-12 gap-y-4">
              <dl className="flex flex-wrap gap-x-12 gap-y-4">
                <div>
                  <dt className="text-faded">Status</dt>
                  <dd data-testid="overview-run-status" className="font-semibold">
                    <StatusDot tone={run.status === "running" ? "live" : run.status === "success" ? "plain" : "alert"}>{statusLabel(run.status)}</StatusDot>
                  </dd>
                </div>
                <div>
                  <dt className="text-faded">Started</dt>
                  <dd data-testid="overview-run-date" className="font-semibold tabular-nums">
                    {runDate(run.startedAt)}
                  </dd>
                </div>
                {approval && approval.status !== "pending" && (
                  <div>
                    <dt className="text-faded">Approval</dt>
                    <dd data-testid="overview-decision" className={`font-semibold ${approval.status === "approved" ? "" : "text-alert"}`}>
                      {approval.status === "approved" ? "Approved" : "Denied"} by {approval.approvedBy}
                      {approval.channel && `, ${APPROVAL_CHANNELS[approval.channel]}`}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-faded">Findings</dt>
                  <dd className="font-semibold tabular-nums">{snapshot?.findings.length ?? 0}</dd>
                </div>
              </dl>
              <div className="ml-auto flex flex-wrap gap-3">
                <ButtonLink href="/findings" variant="secondary">
                  See findings
                </ButtonLink>
                <ButtonLink href="/money" variant="secondary">
                  See money
                </ButtonLink>
              </div>
            </div>
          ) : (
            <p className="text-faded">Loading</p>
          )}
        </section>
      </div>
    </Page>
  );
}
