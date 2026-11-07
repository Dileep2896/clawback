import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm";
import type { Db } from "@bill-fighter/db/client";
import {
  actions,
  approvals,
  auditLog,
  boardCards,
  calls,
  customers,
  findings,
  ledger,
  runs,
  smsMessages,
} from "@bill-fighter/db/schema";

// Enough for a scrolling log on one screen, and it keeps every poll small when a run has thousands of rows.
export const AUDIT_ROW_LIMIT = 200;

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export type LiveData = {
  run: Row<typeof runs> | null;
  customer: Row<typeof customers> | null;
  humanActions: number;
  approval: Row<typeof approvals> | null;
  boardCards: Row<typeof boardCards>[];
  findings: Row<typeof findings>[];
  actions: Row<typeof actions>[];
  calls: Row<typeof calls>[];
  ledger: Row<typeof ledger>[];
  sms: Row<typeof smsMessages>[];
  // No input or output: those columns can hold tool data, so they never reach the browser.
  auditLog: Pick<Row<typeof auditLog>, "id" | "agent" | "tool" | "costUsd" | "createdAt">[];
  auditTotal: number;
};

/** What the browser receives: JSON turns every Date into a string. */
type Wire<T> = T extends Date ? string : T extends (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
export type Snapshot = Wire<LiveData>;

const NO_RUN: LiveData = {
  run: null,
  customer: null,
  humanActions: 0,
  approval: null,
  boardCards: [],
  findings: [],
  actions: [],
  calls: [],
  ledger: [],
  sms: [],
  auditLog: [],
  auditTotal: 0,
};

/** Everything on the screen, for the most recently started run. Every list has a fixed order, so unchanged data serializes the same. */
export async function liveSnapshot(db: Db): Promise<LiveData> {
  const [run] = await db.select().from(runs).orderBy(desc(runs.startedAt), desc(runs.id)).limit(1);
  if (!run) return NO_RUN;

  const [customerRows, approvalRows, customerFindings] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, run.customerId)),
    db.select().from(approvals).where(eq(approvals.runId, run.id)),
    db.select().from(findings).where(eq(findings.customerId, run.customerId)).orderBy(asc(findings.id)),
  ]);
  const approval = approvalRows[0] ?? null;

  // Invoices and card payments have no finding, so a bundle can hold actions the findings do not reach.
  const runActions = await db
    .select()
    .from(actions)
    .where(
      or(
        inArray(actions.findingId, customerFindings.map((f) => f.id)),
        inArray(actions.id, approval?.actionIds ?? []),
      ),
    )
    .orderBy(asc(actions.id));

  const [humanActions, cards, runCalls, ledgerRows, sms, audit, auditTotal] = await Promise.all([
    // Counts decided rows, not clicks or texts: decideApproval lets one decision win, so button plus SMS is still 1.
    db.$count(approvals, and(eq(approvals.runId, run.id), eq(approvals.status, "approved"))),
    db.select().from(boardCards).where(eq(boardCards.runId, run.id)).orderBy(asc(boardCards.updatedAt), asc(boardCards.id)),
    db.select().from(calls).where(inArray(calls.actionId, runActions.map((a) => a.id))).orderBy(asc(calls.startedAt), asc(calls.id)),
    db.select().from(ledger).where(eq(ledger.customerId, run.customerId)).orderBy(asc(ledger.createdAt), asc(ledger.id)),
    // shortcut: sms_messages has no run or customer id, so a run's thread is found by time. Add a run_id if runs ever overlap.
    db.select().from(smsMessages).where(gte(smsMessages.createdAt, run.startedAt)).orderBy(asc(smsMessages.createdAt), asc(smsMessages.id)),
    db
      .select({ id: auditLog.id, agent: auditLog.agent, tool: auditLog.tool, costUsd: auditLog.costUsd, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(eq(auditLog.runId, run.id))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(AUDIT_ROW_LIMIT),
    db.$count(auditLog, eq(auditLog.runId, run.id)),
  ]);

  return {
    run,
    customer: customerRows[0] ?? null,
    humanActions,
    approval,
    boardCards: cards,
    findings: customerFindings,
    actions: runActions,
    calls: runCalls,
    ledger: ledgerRows,
    sms,
    auditLog: audit,
    auditTotal,
  };
}
