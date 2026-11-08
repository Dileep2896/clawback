import { and, asc, count, desc, eq, gte, inArray, max, min, or, sql } from "drizzle-orm";
import type { Db } from "@bill-fighter/db/client";
import {
  accounts,
  actions,
  approvals,
  auditLog,
  bills,
  boardCards,
  calls,
  customers,
  findings,
  ledger,
  locations,
  runs,
  scheduledChecks,
  smsMessages,
  usageIntervals,
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
  /** Location name by account id: rule titles do not name the site. */
  findingSites: Record<string, string>;
  actions: Row<typeof actions>[];
  calls: Row<typeof calls>[];
  ledger: Row<typeof ledger>[];
  /** The customer's bills with their account and site. No parsed JSON: it is large and the pages show only these columns. */
  bills: BillRow[];
  sms: Row<typeof smsMessages>[];
  // No input or output: those columns can hold tool data, so they never reach the browser.
  auditLog: Pick<Row<typeof auditLog>, "id" | "agent" | "tool" | "costUsd" | "createdAt">[];
  auditTotal: number;
  scheduledChecks: Row<typeof scheduledChecks>[];
  /** Picked from this run's tool rows, never a whole input or output: the sender and subject Intake read. A replay has none. */
  email: { from: string; subject: string } | null;
  /** The wording Filer drafted, by finding id, from its successful draft_letter calls. A replay has none. */
  letterWording: Record<string, string>;
  /** The usage on file per account: what the collector stored. */
  usage: { accountId: string; meterNumber: string | null; intervals: number; from: Date | null; to: Date | null }[];
};

type BillRow = Pick<Row<typeof bills>, "id" | "periodStart" | "periodEnd" | "totalCents" | "parseConfidence"> &
  Pick<Row<typeof accounts>, "provider" | "accountNumber" | "serviceType"> & { accountId: string; locationId: string; site: string; city: string };

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
  findingSites: {},
  actions: [],
  calls: [],
  ledger: [],
  bills: [],
  sms: [],
  auditLog: [],
  auditTotal: 0,
  scheduledChecks: [],
  email: null,
  letterWording: {},
  usage: [],
};

/** One customer's bills with their account and site, ordered by site then account. Also the Bills page for a customer with no run yet. */
export function customerBills(db: Db, customerId: string): Promise<BillRow[]> {
  return db
    .select({
      id: bills.id,
      periodStart: bills.periodStart,
      periodEnd: bills.periodEnd,
      totalCents: bills.totalCents,
      parseConfidence: bills.parseConfidence,
      accountId: accounts.id,
      provider: accounts.provider,
      accountNumber: accounts.accountNumber,
      serviceType: accounts.serviceType,
      locationId: locations.id,
      site: locations.name,
      city: locations.city,
    })
    .from(bills)
    .innerJoin(accounts, eq(bills.accountId, accounts.id))
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(eq(locations.customerId, customerId))
    .orderBy(asc(locations.name), asc(locations.id), asc(accounts.id), desc(bills.periodStart), asc(bills.id));
}

/**
 * Everything on the screen, for the customer's most recently started run. Every list has a fixed order, so unchanged data serializes the same.
 * /api/live passes the signed-in customer, so a new sign-up sees no audit rather than the demo run. Without one (tests), the latest run of all.
 * A customer with no run still gets their bills, which a sign-up can upload before any audit.
 */
export async function liveSnapshot(db: Db, customerId?: string): Promise<LiveData> {
  const [run] = await db
    .select()
    .from(runs)
    .where(customerId === undefined ? undefined : eq(runs.customerId, customerId))
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(1);
  if (!run) return customerId === undefined ? NO_RUN : { ...NO_RUN, bills: await customerBills(db, customerId) };

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

  const siteAccountIds = customerFindings.flatMap((f) => f.accountId ?? []);

  const [sites, humanActions, cards, runCalls, ledgerRows, billRows, sms, audit, auditTotal, checks, picks, usage] = await Promise.all([
    db
      .select({ accountId: accounts.id, name: locations.name })
      .from(accounts)
      .innerJoin(locations, eq(accounts.locationId, locations.id))
      .where(inArray(accounts.id, siteAccountIds))
      .orderBy(asc(accounts.id)),
    // Counts decided rows, not clicks or texts: decideApproval lets one decision win, so button plus SMS is still 1.
    db.$count(approvals, and(eq(approvals.runId, run.id), eq(approvals.status, "approved"))),
    db.select().from(boardCards).where(eq(boardCards.runId, run.id)).orderBy(asc(boardCards.updatedAt), asc(boardCards.id)),
    db.select().from(calls).where(inArray(calls.actionId, runActions.map((a) => a.id))).orderBy(asc(calls.startedAt), asc(calls.id)),
    db.select().from(ledger).where(eq(ledger.customerId, run.customerId)).orderBy(asc(ledger.createdAt), asc(ledger.id)),
    customerBills(db, run.customerId),
    // shortcut: sms_messages has no run or customer id, so a run's thread is found by time. Add a run_id if runs ever overlap.
    db.select().from(smsMessages).where(gte(smsMessages.createdAt, run.startedAt)).orderBy(asc(smsMessages.createdAt), asc(smsMessages.id)),
    db
      .select({ id: auditLog.id, agent: auditLog.agent, tool: auditLog.tool, costUsd: auditLog.costUsd, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(eq(auditLog.runId, run.id))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(AUDIT_ROW_LIMIT),
    db.$count(auditLog, eq(auditLog.runId, run.id)),
    db.select().from(scheduledChecks).where(eq(scheduledChecks.customerId, run.customerId)).orderBy(asc(scheduledChecks.runAt)),
    // Only these fields leave the database: other tool rows can hold vault names and raw email bodies.
    db
      .select({
        tool: auditLog.tool,
        from: sql<string | null>`${auditLog.outputJson}->>'from'`,
        subject: sql<string | null>`${auditLog.outputJson}->>'subject'`,
        letters: sql<{ findingId: string; wording: string }[] | null>`case when jsonb_typeof(${auditLog.outputJson}) = 'array' then ${auditLog.inputJson}->'letters' end`,
      })
      .from(auditLog)
      .where(and(eq(auditLog.runId, run.id), inArray(auditLog.tool, ["parse_inbound_email", "draft_letter"])))
      .orderBy(asc(auditLog.createdAt), asc(auditLog.id)),
    db
      .select({ accountId: accounts.id, meterNumber: accounts.meterNumber, intervals: count(), from: min(usageIntervals.ts), to: max(usageIntervals.ts) })
      .from(usageIntervals)
      .innerJoin(accounts, eq(usageIntervals.accountId, accounts.id))
      .innerJoin(locations, eq(accounts.locationId, locations.id))
      .where(eq(locations.customerId, run.customerId))
      .groupBy(accounts.id)
      .orderBy(asc(accounts.id)),
  ]);
  const read = picks.findLast((p) => p.tool === "parse_inbound_email" && p.from && p.subject);
  // Oldest first, so a redraft's wording wins.
  const letterWording = Object.fromEntries(picks.flatMap((p) => (Array.isArray(p.letters) ? p.letters.map((l) => [l.findingId, l.wording]) : [])));

  return {
    run,
    customer: customerRows[0] ?? null,
    humanActions,
    approval,
    boardCards: cards,
    findings: customerFindings,
    findingSites: Object.fromEntries(sites.map((site) => [site.accountId, site.name])),
    actions: runActions,
    calls: runCalls,
    ledger: ledgerRows,
    bills: billRows,
    sms,
    auditLog: audit,
    auditTotal,
    scheduledChecks: checks,
    email: read ? { from: read.from!, subject: read.subject! } : null,
    letterWording,
    usage,
  };
}
