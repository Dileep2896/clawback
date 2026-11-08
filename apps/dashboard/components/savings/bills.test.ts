import { expect, it } from "vitest";
import { billStatuses, bySite, statusFilter } from "./bills.tsx";

const bill = (id: string, locationId: string, city: string) =>
  ({ id, locationId, site: "Store #1", city, accountId: `${locationId}-acct` }) as Parameters<typeof bySite>[0][number];

it("keeps two locations with the same name apart, each with its own city", () => {
  const groups = bySite([bill("a1", "loc-a", "Fremont"), bill("a2", "loc-a", "Fremont"), bill("b1", "loc-b", "Oakland")]);
  expect(groups.map(([id, bills]) => [id, bills[0]!.city, bills.map((b) => b.id)])).toEqual([
    ["loc-a", "Fremont", ["a1", "a2"]],
    ["loc-b", "Oakland", ["b1"]],
  ]);
});

const meterBill = (billId: string, overbilledCents: number) => ({ billId, periodStart: "2025-09-01", billedKwh: 2, intervalKwh: 1, billedCents: 2, correctCents: 1, overbilledCents });
const meter = {
  type: "meterMultiplierJump",
  accountId: "fremont",
  evidenceJson: {
    billIds: ["aug", "sep", "oct"],
    billLineIds: [],
    phoneLineIds: [],
    detail: { swapMonth: "2025-09", oldMeter: "A", newMeter: "B", kwhRatio: 2, bills: [meterBill("aug", 0), meterBill("sep", 500), meterBill("oct", 500)] },
  },
};
const rate = {
  type: "rateOptimization",
  accountId: "oakland",
  evidenceJson: { billIds: ["oak-1"], billLineIds: [], phoneLineIds: [], detail: {} },
};

it("marks only the bills the evidence shows overbilled, and the rest of a flagged account at account level", () => {
  const statusOf = billStatuses([meter, rate]);
  expect(statusOf({ id: "sep", accountId: "fremont" })).toBe("Overcharged");
  expect(statusOf({ id: "oct", accountId: "fremont" })).toBe("Overcharged");
  expect(statusOf({ id: "aug", accountId: "fremont" })).toBe("Finding on account");
  // A rate finding lists bills too, but a better plan is not an overcharge on them.
  expect(statusOf({ id: "oak-1", accountId: "oakland" })).toBe("Finding on account");
  expect(statusOf({ id: "x", accountId: "elsewhere" })).toBe("OK");
});

it("drops a Status pick that no bill has any more, so a hidden chip cannot keep filtering", () => {
  const bills = [
    { id: "sep", accountId: "fremont" },
    { id: "oak-1", accountId: "oakland" },
  ];
  // Before: no findings, every bill OK, and the user picks OK.
  expect(statusFilter(bills, billStatuses([]), "OK")).toEqual({ options: ["OK"], active: "OK" });
  // Live findings then flag both accounts: OK is gone, so the pick no longer applies.
  const flagged = billStatuses([meter, { ...rate, accountId: "oakland" }]);
  expect(statusFilter(bills, flagged, "OK")).toEqual({ options: ["Overcharged", "Finding on account"], active: null });
  expect(statusFilter(bills, flagged, "Overcharged").active).toBe("Overcharged");
});
