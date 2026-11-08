import { expect, it } from "vitest";
import { findingActivity } from "./activity.ts";

type Input = Parameters<typeof findingActivity>[1];

const snapshot = {
  actions: [
    { id: "a1", findingId: "f1", kind: "claim" },
    { id: "a2", findingId: "other", kind: "call" },
  ],
  approval: { actionIds: ["a1"], status: "approved", approvedBy: "Linda Park", channel: "dashboard", approvedAt: "2026-11-07T10:00:05.000Z" },
  calls: [{ actionId: "a2", toNumber: "(415) 555-0100", startedAt: "2026-11-07T10:00:01.000Z", endedAt: null }],
  ledger: [
    { findingId: "f1", kind: "refund", amountCents: 1260606, createdAt: "2026-11-07T10:00:09.000Z" },
    { findingId: "other", kind: "savings", amountCents: 100, createdAt: "2026-11-07T10:00:02.000Z" },
  ],
} as unknown as Input;

it("lists only this finding's rows, untimed first, then in time order", () => {
  expect(findingActivity({ id: "f1", type: "arithmeticCheck", evidenceJson: null }, snapshot)).toEqual([
    { at: null, text: "Found by the auditor" },
    { at: null, text: "Proposed a refund claim" },
    { at: "2026-11-07T10:00:05.000Z", text: "Approved by Linda Park on the dashboard" },
    { at: "2026-11-07T10:00:09.000Z", text: "Refund claimed: $12,606.06" },
  ]);
});

it("says so when nothing acts on a finding", () => {
  expect(findingActivity({ id: "promo", type: "promoExpiry", evidenceJson: null }, snapshot)).toEqual([
    { at: null, text: "Found by the auditor" },
    { at: null, text: "Found, not acted on" },
  ]);
});

const cancel = (id: string, number: string) => ({
  id,
  type: "unusedLines",
  evidenceJson: {
    billIds: [],
    billLineIds: [],
    phoneLineIds: [`pl-${number}`],
    detail: { number, label: null, purpose: "voice", callsLast12mo: 0, monthlyCents: 4500, action: "cancel" },
  },
});

// The approver's shape: one cancel action per finding, one bundled call with no finding that names the lines.
const bundled = {
  actions: [
    { id: "cancel-run-f2", findingId: "f2", kind: "cancel", payloadJson: null },
    { id: "call-run", findingId: null, kind: "call", payloadJson: { accountNumber: "BT-1", cancelLines: ["(510) 555-0101"], promoAccounts: [] } },
    { id: "call-other", findingId: null, kind: "call", payloadJson: { accountNumber: "BT-2", cancelLines: ["(510) 555-0199"], promoAccounts: [] } },
  ],
  approval: { actionIds: ["cancel-run-f2", "call-run"], status: "approved", approvedBy: null, channel: "sms", approvedAt: "2026-11-07T10:00:01.000Z" },
  calls: [
    { actionId: "call-run", toNumber: "(800) 555-0100", startedAt: "2026-11-07T10:00:02.000Z", endedAt: "2026-11-07T10:03:00.000Z" },
    { actionId: "call-other", toNumber: "(800) 555-0199", startedAt: "2026-11-07T10:00:03.000Z", endedAt: null },
  ],
  ledger: [],
} as unknown as Input;

it("shows the bundled provider call on the cancellation it carries, and no unrelated call", () => {
  expect(findingActivity(cancel("f2", "(510) 555-0101"), bundled)).toEqual([
    { at: null, text: "Found by the auditor" },
    { at: null, text: "Proposed a line cancellation" },
    { at: null, text: "Proposed a call to the provider" },
    { at: "2026-11-07T10:00:01.000Z", text: "Approved by you by SMS" },
    { at: "2026-11-07T10:00:02.000Z", text: "Called (800) 555-0100" },
    { at: "2026-11-07T10:03:00.000Z", text: "Call ended" },
  ]);
});

it("leaves the bundled call off findings it does not cancel", () => {
  const texts = findingActivity({ id: "f1", type: "arithmeticCheck", evidenceJson: null }, bundled).map((entry) => entry.text);
  expect(texts).not.toContain("Proposed a call to the provider");
  expect(texts.some((text) => text.startsWith("Called"))).toBe(false);
});
