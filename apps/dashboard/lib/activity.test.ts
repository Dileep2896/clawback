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
  expect(findingActivity({ id: "f1" }, snapshot)).toEqual([
    { at: null, text: "Found by the auditor" },
    { at: null, text: "Proposed a refund claim" },
    { at: "2026-11-07T10:00:05.000Z", text: "Approved by Linda Park on the dashboard" },
    { at: "2026-11-07T10:00:09.000Z", text: "Refund claimed: $12,606.06" },
  ]);
});

it("says so when nothing acts on a finding", () => {
  expect(findingActivity({ id: "promo" }, snapshot)).toEqual([
    { at: null, text: "Found by the auditor" },
    { at: null, text: "Found, not acted on" },
  ]);
});
