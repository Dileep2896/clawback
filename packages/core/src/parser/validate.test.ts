import type { ParsedBill, ParsedBillLine } from "@bill-fighter/shared/parsed-bill";
import { describe, expect, it } from "vitest";
import { validateParsedBill } from "./validate.ts";

const energy: ParsedBillLine = { description: "Peak energy", quantity: 100, unit: "kWh", rate: 0.2, amountCents: 2000, lineType: "energy" };
const fee: ParsedBillLine = { description: "Customer charge", quantity: null, unit: null, rate: null, amountCents: 500, lineType: "fixed" };

const bill = (lineItems: ParsedBillLine[], overrides: Partial<ParsedBill> = {}): ParsedBill => ({
  accountNumber: "A-1",
  serviceAddress: null,
  providerName: "Provider",
  serviceType: "electric",
  meterNumber: "M-1",
  multiplier: 1,
  rateSchedule: "B-1",
  planCode: null,
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  kwhByTouPeriod: [],
  maxKw: null,
  lineItems,
  totalCents: lineItems.reduce((sum, line) => sum + line.amountCents, 0),
  ...overrides,
});

describe("validateParsedBill", () => {
  it("passes a bill that adds up", () => {
    expect(validateParsedBill(bill([energy, fee]))).toEqual([]);
  });

  it.each([-1, 1])("fails when the lines miss the total by %i cent", (off) => {
    expect(validateParsedBill(bill([energy, fee], { totalCents: 2500 + off })).join()).toMatch(/Lines sum to 2500/);
  });

  it("keeps a prior balance and credits in the sum", () => {
    const prior = { ...fee, description: "Previous unpaid balance", amountCents: 42056, lineType: "prior_balance" };
    const credit = { ...fee, description: "Credit", amountCents: -369, lineType: "credit" };
    expect(validateParsedBill(bill([energy, prior, credit]))).toEqual([]);
  });

  it("allows kWh x rate exactly 1% off and fails just past it", () => {
    expect(validateParsedBill(bill([{ ...energy, amountCents: 2020 }]))).toEqual([]);
    expect(validateParsedBill(bill([{ ...energy, amountCents: 2023 }])).join()).toMatch(/more than 1%/);
  });

  it("checks every kWh line by its unit, whatever its lineType or the case of the unit", () => {
    const line = { ...energy, unit: "KWH", lineType: "other", amountCents: 9999 };
    expect(validateParsedBill(bill([energy, line])).join()).toMatch(/more than 1%/);
  });

  it("does not apply the kWh check to other units", () => {
    const line = { ...energy, unit: "days", amountCents: 9999 };
    expect(validateParsedBill(bill([energy, line]))).toEqual([]);
  });

  it("fails an electric bill whose kWh lines have no rates, instead of skipping the check", () => {
    expect(validateParsedBill(bill([{ ...energy, rate: null }])).join()).toMatch(/no kWh line/);
  });

  it("does not require a kWh line on other services", () => {
    expect(validateParsedBill(bill([fee], { serviceType: "internet" }))).toEqual([]);
  });

  it("fails a bill with no lines, which would otherwise sum cleanly to 0", () => {
    expect(validateParsedBill(bill([], { serviceType: "internet" }))).toEqual(["The bill has no line items"]);
  });

  it("fails a period that ends before it starts", () => {
    expect(validateParsedBill(bill([energy], { periodEnd: "2025-12-31" })).join()).toMatch(/before it starts/);
  });
});
