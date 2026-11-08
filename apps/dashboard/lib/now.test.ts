import { expect, it } from "vitest";
import { nowMoment } from "./now.ts";
import type { Snapshot } from "./snapshot.ts";

const T0 = "2026-11-07T12:00:00.000Z";
const LATER = "2026-11-07T12:04:00.000Z";
const empty = { run: { startedAt: T0, status: "running" }, bills: [], findings: [], approval: null, calls: [], ledger: [], boardCards: [] };
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
  expect(nowMoment(pending, null, true)).toBe("findings");
  expect(nowMoment(at({ findings, calls: [{ endedAt: null }] }), null, true)).toBe("findings");
  // Closed again: the run's moment comes back.
  expect(nowMoment(pending, null, false)).toBe("approval");
});

it("shows a picked agent's own moment, or its steps when it has none yet", () => {
  const s = at({ bills, findings, approval: { status: "approved" }, calls: [{ endedAt: LATER }], ledger: [{ createdAt: LATER }] });
  expect(nowMoment(s, "collector")).toBe("bills");
  expect(nowMoment(s, "auditor")).toBe("findings");
  expect(nowMoment(s, "approver")).toBe("approval");
  expect(nowMoment(s, "negotiator")).toBe("call");
  expect(nowMoment(s, "finance")).toBe("ledger");
  expect(nowMoment(at({}), "negotiator")).toBe("steps");
  expect(nowMoment(s, "ceo")).toBe("steps");
});
