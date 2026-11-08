import { expect, it } from "vitest";
import { ROSTER } from "./agents.ts";
import { amountOf, nowMoment } from "./now.ts";
import type { Snapshot } from "./snapshot.ts";

const T0 = "2026-11-07T12:00:00.000Z";
const LATER = "2026-11-07T12:04:00.000Z";
const empty = { run: { startedAt: T0, status: "running" }, bills: [], findings: [], approval: null, calls: [], ledger: [], boardCards: [], auditLog: [] };
const at = (over: object) => ({ ...empty, ...over }) as unknown as Snapshot;
const bills = [{ id: "b" }];
const findings = [{ id: "f" }];

it("follows the run from the bills to the findings to the approval", () => {
  expect(nowMoment(at({}))).toBe("steps");
  expect(nowMoment(at({ bills }))).toBe("bills");
  expect(nowMoment(at({ bills, findings }))).toBe("findings");
  expect(nowMoment(at({ bills, findings, approval: { status: "pending" } }))).toBe("approval");
  // Decided: back to the findings until the call starts.
  expect(nowMoment(at({ bills, findings, approval: { status: "approved" } }))).toBe("findings");
});

it("shows the call while it is open, and its transcript while the negotiator is still on it", () => {
  const open = [{ id: "c", endedAt: null }];
  const ended = [{ id: "c", endedAt: LATER }];
  expect(nowMoment(at({ findings, calls: open }))).toBe("call");
  expect(nowMoment(at({ findings, calls: ended, boardCards: [{ agent: "negotiator", status: "doing" }] }))).toBe("call");
  expect(nowMoment(at({ findings, calls: ended, boardCards: [{ agent: "negotiator", status: "done" }] }))).toBe("findings");
});

it("ends on the money, counting only ledger rows this run wrote", () => {
  expect(nowMoment(at({ findings, ledger: [{ createdAt: LATER }] }))).toBe("ledger");
  // An earlier audit's ledger rows are not this run reaching the money.
  expect(nowMoment(at({ findings, ledger: [{ createdAt: "2026-10-01T00:00:00.000Z" }] }))).toBe("findings");
});

it("reaches the money on a repeat audit whose ledger rows were updated in place", () => {
  // record_savings updates the earlier rows without touching createdAt; this run's finance card finishing is the evidence.
  const old = [{ createdAt: "2026-10-01T00:00:00.000Z" }];
  expect(nowMoment(at({ findings, ledger: old, boardCards: [{ agent: "finance", status: "doing" }] }))).toBe("findings");
  expect(nowMoment(at({ findings, ledger: old, boardCards: [{ agent: "finance", status: "done" }] }))).toBe("ledger");
});

it("keeps the findings while their evidence is open, with no agent picked", () => {
  const pending = at({ bills, findings, approval: { status: "pending" } });
  expect(nowMoment(pending, null, "f")).toBe("findings");
  expect(nowMoment(at({ findings, calls: [{ endedAt: null }] }), null, "f")).toBe("findings");
  // Closed again: the run's moment comes back.
  expect(nowMoment(pending, null, null)).toBe("approval");
});

it("lets the run move on when an audit removed the finding whose evidence was open", () => {
  // "f" is gone, "g" remains: the stale selection must not hold the findings over the approval.
  const pending = at({ bills, findings: [{ id: "g" }], approval: { status: "pending" } });
  expect(nowMoment(pending, null, "f")).toBe("approval");
});

it("shows the bills while a repeat audit collects, though an earlier audit's findings are there", () => {
  const collector = [{ agent: "collector", status: "doing" }];
  expect(nowMoment(at({ bills, findings, boardCards: collector }))).toBe("bills");
  expect(nowMoment(at({ bills, findings, auditLog: [{ agent: "collector" }] }))).toBe("bills");
  // The auditor starting this run is the run reaching the findings.
  expect(nowMoment(at({ bills, findings, boardCards: [...collector, { agent: "auditor", status: "doing" }] }))).toBe("findings");
  expect(nowMoment(at({ bills, findings, boardCards: collector, auditLog: [{ agent: "filer" }] }))).toBe("findings");
});

it("gives every picked agent its own view, the approval and the call once they exist", () => {
  const s = at({ bills, findings, approval: { status: "approved" }, calls: [{ endedAt: LATER }], ledger: [{ createdAt: LATER }] });
  const views = ROSTER.map((agent) => nowMoment(s, agent));
  expect(views).toEqual(["intake", "collector", "auditor", "filer", "approval", "call", "ledger", "monitor"]);
  expect(new Set(views).size).toBe(ROSTER.length);
  expect(nowMoment(at({}), "approver")).toBe("steps");
  expect(nowMoment(at({}), "negotiator")).toBe("steps");
  expect(nowMoment(s, "ceo")).toBe("steps");
  // A pick holds while evidence is open: the auditor's view has the findings and their drawer.
  expect(nowMoment(s, "auditor", "f")).toBe("auditor");
});

it("shows a finding's refund and its yearly savings together", () => {
  expect(amountOf({ refundCents: 1_260_000, annualSavingsCents: 1_080_000 })).toBe("$12,600.00 refund · $10,800.00 a year");
  expect(amountOf({ refundCents: 1_260_000, annualSavingsCents: 0 })).toBe("$12,600.00 refund");
  expect(amountOf({ refundCents: 0, annualSavingsCents: 1_080_000 })).toBe("$10,800.00 a year");
  expect(amountOf({ refundCents: 0, annualSavingsCents: 0 })).toBe("To check");
});
