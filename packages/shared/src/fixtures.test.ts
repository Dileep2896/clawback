import { describe, expect, it } from "vitest";
import {
  AccountFixture,
  BillFixture,
  CustomerFixture,
  GAS_SUPPLIER,
  PhoneLineFixture,
  Provider,
  ServiceType,
  UsageIntervalFixture,
} from "./fixtures.ts";

const bill = {
  id: "bill-1",
  accountId: "acct-1",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  totalCents: 180000,
  pdfPath: null,
  meterNumber: "M-2",
  multiplier: 2,
  rateSchedule: "B-10",
  planCode: null,
  kwhByTouPeriod: [{ period: "peak", kwh: 100 }],
  maxKw: 40,
  lines: [
    {
      id: "line-1",
      description: "Energy",
      quantity: 100,
      unit: "kWh",
      rate: 0.24512,
      amountCents: 180000,
      lineType: "energy",
    },
  ],
};

describe("enums", () => {
  it("use the agreed spellings", () => {
    expect(Provider.options).toEqual(["baycurrent", "baytel", "bayconnect", "bayhearth"]);
    expect(ServiceType.options).toEqual(["electric", "gas", "telecom", "internet"]);
  });

  it("names the gas supplier", () => {
    expect(GAS_SUPPLIER).toEqual({ provider: "bayhearth", name: "BayHearth Energy" });
  });
});

describe("fixtures", () => {
  it("accept valid rows", () => {
    expect(BillFixture.parse(bill)).toEqual(bill);
    expect(
      AccountFixture.safeParse({
        id: "acct-1",
        locationId: "loc-1",
        provider: "bayhearth",
        accountNumber: "123",
        serviceType: "gas",
        rateSchedule: null,
        meterNumber: null,
      }).success,
    ).toBe(true);
    expect(
      PhoneLineFixture.safeParse({
        id: "pl-1",
        accountId: "acct-1",
        number: "+15550001234",
        label: "Fax",
        monthlyCents: 6000,
        callsLast12mo: 0,
        purpose: "fax",
      }).success,
    ).toBe(true);
    expect(
      UsageIntervalFixture.safeParse({
        accountId: "acct-1",
        ts: "2026-01-01T00:15:00-08:00",
        kwh: 1.25,
      }).success,
    ).toBe(true);
  });

  it("refuse a precomputed answer on a row", () => {
    expect(BillFixture.safeParse({ ...bill, annualSavingsCents: 1000 }).success).toBe(false);
    expect(
      CustomerFixture.safeParse({
        id: "c-1",
        name: "Golden Gate Noodle Co.",
        contactName: "Linda Park",
        contactEmail: "linda@billfighter.local",
        contactPhone: "+15550001111",
        savingsSharePct: 30,
        findings: [],
      }).success,
    ).toBe(false);
  });

  it("refuse non-integer cents and an unknown provider", () => {
    expect(BillFixture.safeParse({ ...bill, totalCents: 100.5 }).success).toBe(false);
    expect(
      AccountFixture.safeParse({
        id: "acct-1",
        locationId: "loc-1",
        provider: "pge",
        accountNumber: "123",
        serviceType: "electric",
        rateSchedule: "B-10",
        meterNumber: "M-1",
      }).success,
    ).toBe(false);
  });
});
