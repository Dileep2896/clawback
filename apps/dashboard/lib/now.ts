import type { Snapshot } from "./snapshot.ts";

/** What the Now pane shows: the bills being read, the findings, the approval, the call, the money, or the steps of an agent with none of those. */
export type Moment = "bills" | "findings" | "approval" | "call" | "ledger" | "steps";

const doing = (s: Snapshot, agent: string) => s.boardCards.some((c) => c.agent === agent && c.status === "doing");
// The ledger is per customer, so only rows written since this run started say this run reached the money.
const runLedger = (s: Snapshot) => !!s.run && s.ledger.some((row) => row.createdAt >= s.run!.startedAt);

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
 */
export function nowMoment(s: Snapshot, picked: string | null = null): Moment {
  if (picked) return BY_AGENT[picked]?.(s) ?? "steps";
  if (s.approval?.status === "pending") return "approval";
  if (s.calls.some((c) => !c.endedAt) || (s.calls.length && doing(s, "negotiator"))) return "call";
  if (runLedger(s)) return "ledger";
  if (s.findings.length) return "findings";
  if (s.bills.length) return "bills";
  return "steps";
}
