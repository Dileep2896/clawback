import { emailViewOf } from "./calls.ts";
import { money, parseEvidence } from "./evidence.ts";
import type { Snapshot } from "./snapshot.ts";

export type ActivityEntry = { at: string | null; text: string };

const ACTION_LABEL: Record<string, string> = {
  call: "a call to the provider",
  letter: "a dispute letter",
  claim: "a refund claim",
  plan_change: "a rate plan change",
  cancel: "a line cancellation",
  invoice: "an invoice",
  card_pay: "a card payment",
};
const LEDGER_LABEL: Record<string, string> = { refund: "Refund claimed", savings: "Yearly savings recorded", fee: "Fee recorded", invoice: "Invoiced", card_spend: "Card spend" };
const CHANNEL: Record<string, string> = { dashboard: "on the dashboard", sms: "by SMS", naive: "on naïve" };

/**
 * What happened to one finding, from rows the snapshot already holds. Actions carry no time, so their lines come first with none;
 * the approval, calls and ledger rows follow in time order. Nothing is invented: no row, no line.
 */
export function findingActivity(
  finding: Pick<Snapshot["findings"][number], "id" | "type" | "evidenceJson">,
  snapshot: Pick<Snapshot, "actions" | "approval" | "calls" | "ledger">,
): ActivityEntry[] {
  // The approver bundles every cancellation into one provider call with no finding, naming the lines in its payload.
  const evidence = parseEvidence(finding.type, finding.evidenceJson);
  const line = evidence?.type === "unusedLines" ? evidence.detail.number : null;
  const callsLine = (payload: unknown) => {
    const lines = (payload as { cancelLines?: unknown } | null)?.cancelLines;
    return Array.isArray(lines) && lines.includes(line);
  };
  const own = snapshot.actions.filter(
    (action) => action.findingId === finding.id || (line !== null && action.findingId === null && action.kind === "call" && callsLine(action.payloadJson)),
  );
  const ownIds = new Set(own.map((action) => action.id));
  const untimed: ActivityEntry[] = [{ at: null, text: "Found by the auditor" }];
  if (own.length === 0) untimed.push({ at: null, text: "Found, not acted on" });
  const byEmail = snapshot.approval?.contact === "email";
  for (const action of own) untimed.push({ at: null, text: `Proposed ${action.kind === "call" && byEmail ? "an email to the provider" : (ACTION_LABEL[action.kind] ?? action.kind)}` });

  const timed: ActivityEntry[] = [];
  const approval = snapshot.approval;
  if (approval?.approvedAt && approval.actionIds.some((id) => ownIds.has(id))) {
    const how = approval.channel ? ` ${CHANNEL[approval.channel] ?? approval.channel}` : "";
    timed.push({ at: approval.approvedAt, text: `${approval.status === "denied" ? "Denied" : "Approved"} by ${approval.approvedBy ?? "you"}${how}` });
  }
  for (const call of snapshot.calls.filter((c) => ownIds.has(c.actionId))) {
    if (call.mode === "email") {
      const { sent, reply } = emailViewOf(call);
      // Only rows that exist: "emailed" once the request is stored, a reply only when one came.
      if (sent) timed.push({ at: call.startedAt, text: `Emailed ${call.toNumber}` });
      if (call.endedAt) timed.push({ at: call.endedAt, text: reply ? "BayTel replied by email" : "No reply from BayTel" });
      continue;
    }
    timed.push({ at: call.startedAt, text: `Called ${call.toNumber}` });
    if (call.endedAt) timed.push({ at: call.endedAt, text: "Call ended" });
  }
  for (const row of snapshot.ledger.filter((r) => r.findingId === finding.id)) {
    timed.push({ at: row.createdAt, text: `${LEDGER_LABEL[row.kind] ?? row.kind}: ${money(row.amountCents)}` });
  }
  // ISO strings from one server sort as times. A sort is stable, so ties keep the order above.
  timed.sort((a, b) => a.at!.localeCompare(b.at!));
  return [...untimed, ...timed];
}
