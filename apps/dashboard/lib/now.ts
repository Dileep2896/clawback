import { ROSTER } from "./agents.ts";
import { money } from "./evidence.ts";
import type { Snapshot } from "./snapshot.ts";

/**
 * What the Now pane shows: the bills being read, the findings, the approval, the call, the money, or the steps of an agent with none of those.
 * A picked agent shows its own work: what Intake read, what the collector gathered, the checks the auditor ran, the documents Filer drafted, what Monitor scheduled.
 */
export type Moment = "bills" | "findings" | "approval" | "call" | "ledger" | "steps" | "intake" | "collector" | "auditor" | "filer" | "monitor";
const doing = (s: Snapshot, agent: string) => s.boardCards.some((c) => c.agent === agent && c.status === "doing");
// The ledger is per customer, so only this run's evidence counts: rows written since it started, or (when
// record_savings updated an earlier audit's rows in place, leaving createdAt old) this run's finance card done.
const runLedger = (s: Snapshot) =>
  !!s.run && s.ledger.length > 0 && (s.ledger.some((row) => row.createdAt >= s.run!.startedAt) || s.boardCards.some((c) => c.agent === "finance" && c.status === "done"));

// Findings and bills are per customer, so a repeat audit has an earlier audit's findings while this run still collects.
// This run's own cards and audit rows say how far it got: collecting means intake or collector began and no later agent has.
const began = (s: Snapshot, agent: string) => s.auditLog.some((r) => r.agent === agent) || s.boardCards.some((c) => c.agent === agent && c.status !== "todo");
const collecting = (s: Snapshot) => ["intake", "collector"].some((a) => began(s, a)) && !ROSTER.slice(ROSTER.indexOf("auditor")).some((a) => began(s, a));

/** The view each agent's pick shows. The approval and the call need their data; every other view shows what there is. */
const BY_AGENT: Record<string, (s: Snapshot) => Moment> = {
  intake: () => "intake",
  collector: () => "collector",
  auditor: () => "auditor",
  filer: () => "filer",
  approver: (s) => (s.approval ? "approval" : "steps"),
  negotiator: (s) => (s.calls.length ? "call" : "steps"),
  finance: () => "ledger",
  monitor: () => "monitor",
};

/**
 * Follows the run: the approval while it waits on the owner, the call while the negotiator is on it, then the money,
 * the findings and the bills, whichever the run has reached. A picked agent shows its own view instead.
 * Never a moment with nothing in it: "steps" (the agent's own actions) is the fallback.
 * `openId`: the finding whose evidence drawer is open, so the findings stay until it closes or that finding is gone.
 */
export function nowMoment(s: Snapshot, picked: string | null = null, openId: string | null = null): Moment {
  // Someone reading a finding's evidence keeps the findings on screen: a new moment would close the drawer under them.
  // A pick never changes under the reader, so it comes first; the auditor's view holds the findings and their drawer.
  if (picked) return BY_AGENT[picked]?.(s) ?? "steps";
  if (openId && s.findings.some((f) => f.id === openId)) return "findings";
  if (s.approval?.status === "pending") return "approval";
  if (s.calls.some((c) => !c.endedAt) || (s.calls.length && doing(s, "negotiator"))) return "call";
  if (runLedger(s)) return "ledger";
  if (collecting(s) && s.bills.length) return "bills";
  if (s.findings.length) return "findings";
  if (s.bills.length) return "bills";
  return "steps";
}

/** A finding's money: the refund and the yearly savings, each when nonzero, or "To check". */
export const amountOf = (f: Pick<Snapshot["findings"][number], "refundCents" | "annualSavingsCents">) =>
  [f.refundCents > 0 && `${money(f.refundCents)} refund`, f.annualSavingsCents > 0 && `${money(f.annualSavingsCents)} a year`].filter(Boolean).join(" · ") || "To check";
