"use client";

import { money } from "../../lib/evidence.ts";
import { ledgerView } from "../../lib/ledger.ts";
import { STOPPED_TEXT, statusLabel } from "../../lib/run-state.ts";
import { APPROVAL_CHANNELS, useApprove } from "../../lib/use-approve.ts";
import { useLive } from "../../lib/use-live.tsx";
import { Button, ButtonLink, Card, EmptyState, PageHeader } from "../ui/kit.tsx";
import { NOT_RECORDED, Page, runDate } from "./common.tsx";

function StatementLine({ label, note, testId, children }: { label: string; note?: string; testId: string; children: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <dt>
        <span className="text-[1.375rem] leading-snug font-semibold">{label}</span>
        {note && <span className="block text-base text-faded">{note}</span>}
      </dt>
      <dd data-testid={testId} className="font-figure text-[2rem] leading-none whitespace-nowrap">
        {children}
      </dd>
    </div>
  );
}

/** Only while the bundle waits for a decision: once decided it is one line in Latest audit, so the statement stays on screen. */
function ApprovalCard() {
  const { approval, replay, stopped, busy, failed, approve, canApprove } = useApprove();
  if (approval?.status !== "pending") return null;
  const count = `${approval.actionIds.length} ${approval.actionIds.length === 1 ? "action" : "actions"}, one approval`;

  return (
    <section data-testid="overview-approval" aria-labelledby="approval-title" className="rounded-card border-2 border-alert bg-sheet p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="approval-title" className="text-[1.75rem] leading-tight font-semibold text-alert">
            Approval needed
          </h2>
          <p className="mt-1 font-semibold">{count}</p>
        </div>
        {canApprove && (
          <Button data-testid="overview-approve" disabled={busy} onClick={approve} className="min-h-14 px-10 text-[1.375rem]">
            {busy ? "Approving" : "Approve"}
          </Button>
        )}
      </div>
      {replay && <p className="mt-3 font-semibold">Waiting for the recorded reply</p>}
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
      <p data-testid="overview-approval-summary" className="mt-4 max-w-[75ch] whitespace-pre-line text-faded">
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
        <EmptyState title="Your savings show here once the agents finish" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
          No audit has run yet. Refunds, savings and Clawback&apos;s fee appear here as soon as they are recorded.
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={snapshot?.customer ? `${snapshot.customer.name}, from your latest audit.` : "Loading your latest audit."}
        actions={
          <ButtonLink href="/agents" variant="secondary">
            Watch your agents work
          </ButtonLink>
        }
      />

      <div className="grid gap-6">
        <ApprovalCard />

        <div className="grid gap-6 min-[900px]:grid-cols-[3fr_2fr]">
          {/* The statement: every line is a ledger sum, and "You keep" is the core package's figure, never worked out here. */}
          <section aria-labelledby="statement-title" className="rounded-card border border-line bg-sheet p-6 sm:p-8">
            <h2 id="statement-title" className="text-[1.375rem] leading-snug font-semibold">
              Your statement
            </h2>
            <dl className="mt-2 divide-y divide-line">
              <StatementLine label="Refund claimed" note="Counts when the provider grants it" testId="overview-refund">
                {money(view.refundCents)}
              </StatementLine>
              <StatementLine label="Yearly savings" note="Lower bills from now on, counted for one year" testId="overview-savings">
                {money(view.annualSavingsCents)}
              </StatementLine>
              <StatementLine label="Clawback's fee" note="A share of what we find, nothing up front" testId="overview-fee">
                {view.feeCents === null ? NOT_RECORDED : `− ${money(view.feeCents)}`}
              </StatementLine>
            </dl>
            <div className="mt-2 border-t-2 border-ink pt-5">
              <p className="text-[1.375rem] font-semibold">You keep</p>
              <p data-testid="overview-keeps" className="mt-1 font-figure text-[3.5rem] leading-none text-money sm:text-[5rem]">
                {view.customerKeepsCents === null ? NOT_RECORDED : money(view.customerKeepsCents)}
              </p>
            </div>
          </section>

          <Card title="Latest audit">
            {run ? (
              <dl className="grid gap-4">
                <div>
                  <dt className="text-faded">Status</dt>
                  <dd data-testid="overview-run-status" className="text-[1.375rem] font-semibold">
                    {statusLabel(run.status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-faded">Started</dt>
                  <dd data-testid="overview-run-date" className="text-[1.375rem] font-semibold">
                    {runDate(run.startedAt)}
                  </dd>
                </div>
                {approval && approval.status !== "pending" && (
                  <div>
                    <dt className="text-faded">Approval</dt>
                    <dd data-testid="overview-decision" className={`text-[1.375rem] font-semibold ${approval.status === "approved" ? "text-money" : "text-alert"}`}>
                      {approval.status === "approved" ? "Approved" : "Denied"} by {approval.approvedBy}
                      {approval.channel && `, ${APPROVAL_CHANNELS[approval.channel]}`}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-faded">Findings</dt>
                  <dd className="text-[1.375rem] font-semibold tabular-nums">{snapshot?.findings.length ?? 0}</dd>
                </div>
                <div className="flex flex-wrap gap-3 pt-2">
                  <ButtonLink href="/findings" variant="secondary">
                    See findings
                  </ButtonLink>
                  <ButtonLink href="/money" variant="secondary">
                    See money
                  </ButtonLink>
                </div>
              </dl>
            ) : (
              <p className="text-faded">Loading</p>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
