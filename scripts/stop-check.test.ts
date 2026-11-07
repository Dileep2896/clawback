import { describe, expect, it } from "vitest";
import { type AuditRow, EXPECTED_REFUND_CENTS, EXPECTED_SAVINGS_CENTS, type StopSnapshot, stopProblems } from "./stop-check.ts";

const row = (tool: string, agent: string, outputJson: unknown = {}, inputJson: unknown = {}): AuditRow => ({ agent, tool, inputJson, outputJson });
const actions = (kind: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i}`, kind, payloadJson: null as unknown }));
const MEMBERS = ["intake", "collector", "auditor", "filer", "approver"];

function good(): StopSnapshot {
  const audit = [
    row("store_bill", "collector", { totalStored: 448 }),
    row("parse_bill", "auditor", { cached: 448, fresh: 0 }),
    row("send_sms", "approver"),
    ...MEMBERS.map((member) => row("board_update", "ceo", {}, { cardId: `card-${member}`, status: "done" })),
  ];
  return {
    run: { trigger: "email", platform: "local", status: "running" },
    finished: false,
    approvals: [{ status: "pending", channel: null, approvedBy: null, approvedAt: null, summary: "Everything we found." }],
    bundle: [
      ...actions("cancel", 7),
      { id: "call-1", kind: "call", payloadJson: { cancelLines: Array.from({ length: 7 }, (_, i) => `(415) 555-010${i}`), promoAccounts: ["a", "b", "c"] } },
      { id: "invoice-1", kind: "invoice", payloadJson: {} },
      ...actions("claim", 1),
      ...actions("plan_change", 2),
      ...actions("letter", 7),
    ],
    totals: { refundCents: EXPECTED_REFUND_CENTS, annualSavingsCents: EXPECTED_SAVINGS_CENTS },
    alarmNumbers: ["(408) 555-0124"],
    audit,
    cards: [...MEMBERS.map((member) => ({ id: `card-${member}`, agent: member, status: "done" })), { id: "card-negotiator", agent: "negotiator", status: "doing" }],
    toolCalls: [...audit.map(({ agent, tool }) => ({ agent, tool })), { agent: "ceo", tool: "Agent" }, { agent: "negotiator", tool: "call_provider" }],
    parked: ["call-1"],
    callRows: 0,
    ledgerRows: 0,
    summaryEmails: 0,
    leakedSecrets: 0,
  };
}

describe("stopProblems", () => {
  it("passes a run parked at one pending approval", () => {
    expect(stopProblems(good())).toEqual([]);
  });

  it.each<[string, (s: StopSnapshot) => void, RegExp]>([
    ["a run that ended its turn", (s) => (s.finished = true), /ended their turn/],
    ["nothing parked", (s) => (s.parked = []), /no gated call is parked/],
    ["a parked id outside the bundle", (s) => (s.parked = ["other"]), /not in the bundle/],
    ["two approvals", (s) => s.approvals.push(s.approvals[0]!), /2 approvals/],
    ["an approval already decided", (s) => (s.approvals[0]!.status = "approved"), /not pending/],
    ["a missing cancel", (s) => s.bundle.shift(), /6 cancel actions/],
    ["an alarm line on the call", (s) => ((s.bundle.find((a) => a.kind === "call")!.payloadJson as { cancelLines: string[] }).cancelLines[0] = "408-555-0124"), /alarm line/],
    ["a refund a cent out", (s) => (s.totals.refundCents += 1), /refund is/],
    ["savings a cent out", (s) => (s.totals.annualSavingsCents -= 1), /savings are/],
    ["a gated tool that ran", (s) => s.audit.push(row("call_provider", "negotiator")), /gated tools ran: call_provider/],
    ["a placed call", (s) => (s.callRows = 1), /1 calls placed/],
    ["a ledger write", (s) => (s.ledgerRows = 1), /1 ledger rows/],
    ["record_savings before the decision", (s) => s.audit.push(row("record_savings", "finance")), /record_savings was called/],
    ["a summary attempt, even a refused one", (s) => s.audit.push(row("send_email", "ceo", { error: "pending" })), /send_email was called/],
    ["an email in the inbox", (s) => (s.summaryEmails = 1), /1 emails/],
    ["a second text", (s) => s.audit.push(row("send_sms", "approver")), /2 texts/],
    ["a fresh parse", (s) => (s.audit.find((r) => r.tool === "parse_bill")!.outputJson = { cached: 447, fresh: 1 }), /not all cached/],
    ["a tool call with no audit row", (s) => s.toolCalls.push({ agent: "auditor", tool: "run_audit" }), /run_audit: 1 calls but 0 audit rows/],
    ["a parked id with no gated call behind it", (s) => s.parked.push("cancel-0"), /2 parked, from 1 gated calls/],
    ["a member moving a card", (s) => s.audit.push(row("board_update", "filer")), /board_update called by filer/],
    ["a card never moved", (s) => (s.audit = s.audit.filter((r) => (r.inputJson as { cardId?: string }).cardId !== "card-filer")), /no card for filer was moved/],
    ["a member's card not done", (s) => (s.cards.find((c) => c.agent === "auditor")!.status = "doing"), /no done card for auditor/],
    ["no card for the waiting member", (s) => (s.cards = s.cards.filter((c) => c.agent !== "negotiator")), /waiting member/],
    ["a leaked login", (s) => (s.leakedSecrets = 1), /login values/],
  ])("catches %s", (_, change, message) => {
    const snapshot = good();
    change(snapshot);
    expect(stopProblems(snapshot).join("\n")).toMatch(message);
  });

  it("allows a gated call queued behind a parked one", () => {
    const snapshot = good();
    snapshot.toolCalls.push({ agent: "negotiator", tool: "cancel_service" });
    expect(stopProblems(snapshot)).toEqual([]);
  });

  it("does not count a refused text as sent", () => {
    const snapshot = good();
    snapshot.audit.unshift(row("send_sms", "approver", { error: "Remove #1" }));
    snapshot.toolCalls.unshift({ agent: "approver", tool: "send_sms" });
    expect(stopProblems(snapshot)).toEqual([]);
  });

  it("counts a denied gated call as refused, not run", () => {
    const snapshot = good();
    snapshot.audit.push(row("submit_claim", "filer", { denied: "not in an approved bundle" }));
    snapshot.toolCalls.push({ agent: "filer", tool: "submit_claim" });
    expect(stopProblems(snapshot)).toEqual([]);
  });
});
