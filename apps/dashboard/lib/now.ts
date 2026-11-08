import { ROSTER } from "./agents.ts";
import type { Snapshot } from "./snapshot.ts";

/** What the Now pane shows: the bills being read, the findings, the approval, the call, the money, or the steps of an agent with none of those. */
export type Moment = "bills" | "findings" | "approval" | "call" | "ledger" | "steps";

const doing = (s: Snapshot, agent: string) => s.boardCards.some((c) => c.agent === agent && c.status === "doing");
// The ledger is per customer, so only this run's evidence counts: rows written since it started, or (when
// record_savings updated an earlier audit's rows in place, leaving createdAt old) this run's finance card done.
const runLedger = (s: Snapshot) =>
  !!s.run && s.ledger.length > 0 && (s.ledger.some((row) => row.createdAt >= s.run!.startedAt) || s.boardCards.some((c) => c.agent === "finance" && c.status === "done"));

// Findings and bills are per customer, so a repeat audit has an earlier audit's findings while this run still collects.
// This run's own cards and audit rows say how far it got: collecting means intake or collector began and no later agent has.
const began = (s: Snapshot, agent: string) => s.auditLog.some((r) => r.agent === agent) || s.boardCards.some((c) => c.agent === agent && c.status !== "todo");
const collecting = (s: Snapshot) => ["intake", "collector"].some((a) => began(s, a)) && !ROSTER.slice(ROSTER.indexOf("auditor")).some((a) => began(s, a));

/** The moment each agent's work is shown by, if its data is there yet. */
const BY_AGENT: Record<string, (s: Snapshot) => Moment | null> = {
  intake: (s) => (s.bills.length ? "bills" : null),
  collector: (s) => (s.bills.length ? "bills" : null),
  auditor: (s) => (s.findings.length ? "findings" : s.bills.length ? "bills" : null),
  filer: (s) => (s.findings.length ? "findings" : null),
  approver: (s) => (s.approval ? "approval" : null),
  negotiator: (s) => (s.calls.length ? "call" : null),
  finance: (s) => (s.ledger.length ? "ledger" : null),
  monitor: (s) => (s.ledger.length ? "ledger" : null),
};

/**
 * Follows the run: the approval while it waits on the owner, the call while the negotiator is on it, then the money,
 * the findings and the bills, whichever the run has reached. A picked agent shows its own moment instead.
 * Never a moment with nothing in it: "steps" (the agent's own actions) is the fallback.
 * `openId`: the finding whose evidence drawer is open, so the findings stay until it closes or that finding is gone.
 */
export function nowMoment(s: Snapshot, picked: string | null = null, openId: string | null = null): Moment {
  // Someone reading a finding's evidence keeps the findings on screen: a new moment would close the drawer under them.
  if (openId && s.findings.some((f) => f.id === openId)) return "findings";
  if (picked) return BY_AGENT[picked]?.(s) ?? "steps";
  if (s.approval?.status === "pending") return "approval";
  if (s.calls.some((c) => !c.endedAt) || (s.calls.length && doing(s, "negotiator"))) return "call";
  if (runLedger(s)) return "ledger";
  if (collecting(s) && s.bills.length) return "bills";
  if (s.findings.length) return "findings";
  if (s.bills.length) return "bills";
  return "steps";
}
