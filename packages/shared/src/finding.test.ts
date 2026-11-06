import { describe, expect, it } from "vitest";
import { Finding } from "./finding.ts";

const finding = {
  customerId: "c-1",
  accountId: "acct-1",
  type: "meterMultiplierJump",
  title: "Meter multiplier doubled",
  explanation: "Billed kWh is 2.0 times the interval data after the meter swap.",
  evidence: {
    billIds: ["bill-1"],
    billLineIds: ["line-1"],
    phoneLineIds: [],
    detail: { ratio: 2 },
  },
  refundCents: 1260000,
  annualSavingsCents: 1080000,
  confidence: 0.95,
};

describe("Finding", () => {
  it("accepts a valid finding and defaults status to proposed", () => {
    expect(Finding.parse(finding).status).toBe("proposed");
  });

  it("accepts phone lines alone as evidence", () => {
    const evidence = { billIds: [], billLineIds: [], phoneLineIds: ["pl-1"], detail: {} };
    expect(Finding.safeParse({ ...finding, evidence }).success).toBe(true);
  });

  it("rejects a finding with nothing behind it", () => {
    const evidence = { billIds: [], billLineIds: [], phoneLineIds: [], detail: { ratio: 2 } };
    expect(Finding.safeParse({ ...finding, evidence }).success).toBe(false);
  });

  it("rejects non-integer or negative cents", () => {
    expect(Finding.safeParse({ ...finding, refundCents: 10.5 }).success).toBe(false);
    expect(Finding.safeParse({ ...finding, annualSavingsCents: 10.5 }).success).toBe(false);
    expect(Finding.safeParse({ ...finding, refundCents: -1 }).success).toBe(false);
  });

  it("rejects confidence outside 0 to 1 and unknown types", () => {
    expect(Finding.safeParse({ ...finding, confidence: 1.1 }).success).toBe(false);
    expect(Finding.safeParse({ ...finding, confidence: "high" }).success).toBe(false);
    expect(Finding.safeParse({ ...finding, type: "guess" }).success).toBe(false);
  });
});
