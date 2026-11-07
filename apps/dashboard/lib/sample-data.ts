import { databaseUrl, type Db } from "@bill-fighter/db/client";
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
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { eq, like } from "drizzle-orm";

export const SAMPLE_RUN_ID = "sample-run";

/** For the live check: scripts/ cannot import drizzle-orm directly, because it is not a root dependency. */
export const updateSampleRun = (db: Db, values: { costUsd: number; status: string }) =>
  db.update(runs).set(values).where(eq(runs.id, SAMPLE_RUN_ID));

/** For the live check, for the same reason. */
export const moveSampleCard = (db: Db, id: string, status: "todo" | "doing" | "done" | "blocked") =>
  db.update(boardCards).set({ status }).where(eq(boardCards.id, id));

/** Other lanes and the real demo use the shared database, so a made-up run must never land there. Scripts call this first. */
export function assertNotSharedDb(url: string = databaseUrl()) {
  if (new URL(url).pathname === "/billfighter") {
    throw new Error("Refusing to write sample rows to the shared billfighter database. Set DATABASE_URL in .env to your own database.");
  }
}

// 14 months either side of a meter swap, in the shape meterMultiplierJump writes, so panels-work can draw its chart.
const METER_BILLS = Array.from({ length: 14 }, (_, i) => {
  const intervalKwh = 5800 + (i % 3) * 40;
  const swapped = i >= 2;
  return {
    billId: `sample-bill-${i}`,
    periodStart: `${2025 + Math.floor((6 + i) / 12)}-${String(((6 + i) % 12) + 1).padStart(2, "0")}-01`,
    billedKwh: swapped ? intervalKwh * 2 : intervalKwh,
    intervalKwh,
    kwhRatio: swapped ? 2 : 1,
    billedCents: swapped ? 205_000 : 100_000,
    correctCents: 100_000,
    // The 12 bills after the swap add up to the finding's refund.
    overbilledCents: swapped ? 105_000 : 0,
  };
});
const CLAIMED_BILLS = METER_BILLS.slice(2);

// 12 months in the shape rateOptimization writes. They add up to the schedules below and the finding's savings.
const RATE_MONTHS = Array.from({ length: 12 }, (_, i) => {
  const currentCents = 300_000 + i * 1000;
  const proposedCents = currentCents - (i < 8 ? 10_000 : 9000);
  return {
    billId: `sample-bill-oak-${i}`,
    periodStart: `${2025 + Math.floor((10 + i) / 12)}-${String(((10 + i) % 12) + 1).padStart(2, "0")}-01`,
    currentCents,
    proposedCents,
    savingsPct: Number((((currentCents - proposedCents) / currentCents) * 100).toFixed(2)),
  };
});

// One finding per line, as unusedLines writes them. The first keeps its id, because the ledger and the call point at it.
const LINE_COUNT = 7;
const LINE_MONTHLY_CENTS = 6000;
const LINE_ANNUAL_CENTS = LINE_MONTHLY_CENTS * 12;
const LINE_FINDINGS = Array.from({ length: LINE_COUNT }, (_, i) => {
  const number = `+1555000400${i + 1}`;
  return {
    id: i === 0 ? "sample-finding-lines" : `sample-finding-lines-${i + 1}`,
    customerId: CUSTOMER.id,
    type: "unusedLines",
    title: `Unused line ${number} costs $720.00 a year`,
    explanation: `Back office line ${number} had no calls in 12 months and costs $60.00 a month. Cancelling it saves $720.00 a year.`,
    evidenceJson: {
      billIds: ["sample-bill-tel"],
      billLineIds: [`sample-bill-tel-${i + 1}`],
      phoneLineIds: [`sample-line-${i + 1}`],
      detail: { number, label: "Back office line", purpose: "unknown", callsLast12mo: 0, monthlyCents: LINE_MONTHLY_CENTS, action: "cancel" },
    },
    annualSavingsCents: LINE_ANNUAL_CENTS,
    confidence: 0.9,
    // Won, so the ledger panel has a confirmed row as well as filed ones.
    status: "won" as const,
  };
});

const AUDIT_TOOLS = [
  ["ceo", "board_update"],
  ["intake", "parse_inbound_email"],
  ["intake", "get_customer"],
  ["collector", "portal_login"],
  ["collector", "download_bills"],
  ["collector", "download_usage"],
  ["auditor", "parse_bill"],
  ["auditor", "run_audit"],
  ["approver", "request_approval"],
  ["approver", "send_sms"],
] as const;
// 31 calls at 4 cents each add up to the run's cost below.
const AUDIT_ROWS = 31;
const AUDIT_ROW_COST_USD = 0.04;
const RUN_COST_USD = 1.24;

/**
 * A run frozen mid-flight, for building and checking the dashboard. Not one real moment: a call would normally wait for
 * the approval that is still pending here, but this way every panel has something to draw. Deleting only sample- rows
 * first makes a re-run put everything back, including the approval to pending.
 */
export async function insertSampleRun(db: Db) {
  await db.transaction(async (tx) => {
    await tx.delete(auditLog).where(like(auditLog.id, "sample-%"));
    await tx.delete(boardCards).where(like(boardCards.id, "sample-%"));
    await tx.delete(approvals).where(like(approvals.id, "sample-%"));
    await tx.delete(calls).where(like(calls.id, "sample-%"));
    await tx.delete(ledger).where(like(ledger.id, "sample-%"));
    await tx.delete(actions).where(like(actions.id, "sample-%"));
    await tx.delete(findings).where(like(findings.id, "sample-%"));
    await tx.delete(smsMessages).where(like(smsMessages.id, "sample-%"));
    await tx.delete(runs).where(like(runs.id, "sample-%"));

    await tx.insert(customers).values(CUSTOMER).onConflictDoNothing();
    await tx.insert(runs).values({
      id: SAMPLE_RUN_ID,
      customerId: CUSTOMER.id,
      platform: "local",
      trigger: "email",
      status: "running",
      costUsd: RUN_COST_USD,
    });

    await tx.insert(boardCards).values([
      { id: "sample-card-intake", runId: SAMPLE_RUN_ID, agent: "intake", title: "Read the bill email", status: "done" },
      { id: "sample-card-collector", runId: SAMPLE_RUN_ID, agent: "collector", title: "Download 12 months of bills", status: "done" },
      { id: "sample-card-auditor", runId: SAMPLE_RUN_ID, agent: "auditor", title: "Run every audit rule", status: "done" },
      { id: "sample-card-approver", runId: SAMPLE_RUN_ID, agent: "approver", title: "Ask the owner to approve the fixes", status: "doing" },
      { id: "sample-card-negotiator", runId: SAMPLE_RUN_ID, agent: "negotiator", title: "Call about the unused lines", status: "doing" },
      { id: "sample-card-filer", runId: SAMPLE_RUN_ID, agent: "filer", title: "File the meter refund claim", status: "todo" },
    ]);

    await tx.insert(findings).values([
      {
        id: "sample-finding-meter",
        customerId: CUSTOMER.id,
        type: "meterMultiplierJump",
        title: "Fremont #1 is billed for twice its real usage",
        explanation: "Since the meter swap, billed kWh is exactly 2 times the interval data.",
        evidenceJson: {
          billIds: CLAIMED_BILLS.map((b) => b.billId),
          billLineIds: [],
          phoneLineIds: [],
          detail: {
            swapMonth: "2025-09",
            oldMeter: "BEM-1009011",
            newMeter: "BEM-2204417",
            oldMultiplier: 1,
            newMultiplier: 2,
            kwhRatio: 2,
            claimWindowStart: "2023-08-31",
            bills: METER_BILLS,
          },
        },
        refundCents: 1_260_000,
        annualSavingsCents: 1_080_000,
        confidence: 0.97,
        status: "filed",
      },
      {
        id: "sample-finding-rate",
        customerId: CUSTOMER.id,
        type: "rateOptimization",
        title: "Oakland #1 and #2 qualify for a cheaper rate",
        explanation: "Both peak near 40 kW, under the 75 kW limit for schedule B-6.",
        evidenceJson: {
          billIds: RATE_MONTHS.map((m) => m.billId),
          billLineIds: [],
          phoneLineIds: [],
          detail: {
            currentSchedule: "B-10",
            proposedSchedule: "B-6",
            windowStart: "2025-11-01",
            windowEnd: "2026-10-31",
            peakKw: 40,
            heldKw: 38,
            schedules: [
              { schedule: "B-10", annualCents: 3_666_000, savingsPct: 0 },
              { schedule: "B-6", annualCents: 3_550_000, savingsPct: 3.16 },
              { schedule: "B-1", annualCents: 3_780_000, savingsPct: -3.11 },
            ],
            months: RATE_MONTHS,
          },
        },
        annualSavingsCents: 116_000,
        confidence: 0.9,
        status: "filed",
      },
      ...LINE_FINDINGS,
      {
        id: "sample-finding-alarm",
        customerId: CUSTOMER.id,
        type: "unusedLines",
        title: "Confirm with alarm company: +15550004008",
        explanation: "Alarm line +15550004008 is an alarm line with 2 calls in 12 months. Confirm with the alarm company what depends on it.",
        evidenceJson: {
          billIds: ["sample-bill-tel"],
          billLineIds: ["sample-bill-tel-8"],
          phoneLineIds: ["sample-line-8"],
          detail: { number: "+15550004008", label: "Alarm line", purpose: "alarm", callsLast12mo: 2, monthlyCents: LINE_MONTHLY_CENTS, action: "confirmWithAlarmCompany" },
        },
        confidence: 0.5,
      },
    ]);

    await tx.insert(actions).values([
      { id: "sample-action-claim", findingId: "sample-finding-meter", kind: "claim", status: "proposed" },
      { id: "sample-action-rate", findingId: "sample-finding-rate", kind: "plan_change", status: "proposed" },
      { id: "sample-action-call", findingId: "sample-finding-lines", kind: "call", status: "proposed" },
    ]);

    await tx.insert(approvals).values({
      id: "sample-approval",
      runId: SAMPLE_RUN_ID,
      actionIds: ["sample-action-claim", "sample-action-rate", "sample-action-call"],
      summary: "File one refund claim, change one rate plan and cancel seven unused phone lines.",
    });

    await tx.insert(calls).values({
      id: "sample-call",
      actionId: "sample-action-call",
      mode: "sim",
      toNumber: "+15550003333",
      transcriptJson: [
        { role: "agent", kind: "speech", content: DISCLOSURE_LINE, at: "2026-11-06T17:00:00.000Z" },
        { role: "provider", kind: "speech", content: "For billing, press 2.", at: "2026-11-06T17:00:06.000Z" },
        { role: "agent", kind: "keypress", content: "2", at: "2026-11-06T17:00:08.000Z" },
        { role: "provider", kind: "speech", content: "Thanks for calling BayTel. How can I help?", at: "2026-11-06T17:00:12.000Z" },
      ],
    });

    await tx.insert(ledger).values([
      { id: "sample-ledger-refund", customerId: CUSTOMER.id, findingId: "sample-finding-meter", kind: "refund", amountCents: 1_260_000, description: "Claimed, due only when granted" },
      { id: "sample-ledger-savings-meter", customerId: CUSTOMER.id, findingId: "sample-finding-meter", kind: "savings", amountCents: 1_080_000, description: "Filed, due only when granted" },
      { id: "sample-ledger-savings-rate", customerId: CUSTOMER.id, findingId: "sample-finding-rate", kind: "savings", amountCents: 116_000, description: "Filed, due only when granted" },
      // One row per line, as record_savings writes them.
      ...LINE_FINDINGS.map(({ id: findingId }, i) => ({
        id: `sample-ledger-savings-line-${i + 1}`,
        customerId: CUSTOMER.id,
        findingId,
        kind: "savings" as const,
        amountCents: LINE_ANNUAL_CENTS,
        description: "First year savings",
      })),
      // 30% of the refund and savings rows above.
      { id: "sample-ledger-fee", customerId: CUSTOMER.id, kind: "fee", amountCents: 888_000, description: "30% of refund and first year savings" },
    ]);

    await tx.insert(smsMessages).values([
      { id: "sample-sms-1", direction: "outbound", to: CUSTOMER.contactPhone, from: "+15550002222", body: "Bill Fighter found $12,600 in refunds and $17,000 a year in savings. Reply YES to approve all the fixes." },
    ]);

    const now = Date.now();
    await tx.insert(auditLog).values(
      Array.from({ length: AUDIT_ROWS }, (_, i) => {
        const [agent, tool] = AUDIT_TOOLS[i % AUDIT_TOOLS.length]!;
        return {
          id: `sample-audit-${String(i).padStart(2, "0")}`,
          runId: SAMPLE_RUN_ID,
          agent,
          tool,
          costUsd: AUDIT_ROW_COST_USD,
          createdAt: new Date(now - (AUDIT_ROWS - i) * 20_000),
        };
      }),
    );
  });
}
