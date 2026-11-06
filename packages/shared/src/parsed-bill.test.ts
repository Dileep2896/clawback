import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ParsedBill } from "./parsed-bill.ts";

const electric = {
  accountNumber: "PP-1001",
  serviceAddress: "1 Market St, Fremont, CA",
  providerName: "Pacific Power",
  serviceType: "electric",
  meterNumber: "M-2",
  multiplier: 2,
  rateSchedule: "B-10",
  planCode: null,
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  kwhByTouPeriod: [{ period: "peak", kwh: 100 }],
  maxKw: 40,
  lineItems: [
    {
      description: "Late credit",
      quantity: null,
      unit: null,
      rate: null,
      amountCents: -500,
      lineType: "credit",
    },
  ],
  totalCents: -500,
};

function closedObjects(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(closedObjects);
  if (typeof node !== "object" || node === null) return true;
  const schema = node as Record<string, unknown>;
  if (schema.type === "object" && schema.additionalProperties !== false) return false;
  return Object.values(schema).every(closedObjects);
}

describe("ParsedBill", () => {
  it("accepts an electric bill, with negative lines for credits", () => {
    expect(ParsedBill.parse(electric)).toEqual(electric);
  });

  it("accepts a provider it does not know, so the real sample can parse", () => {
    expect(ParsedBill.safeParse({ ...electric, providerName: "PG&E" }).success).toBe(true);
  });

  it("requires absent values to be explicit nulls", () => {
    expect(ParsedBill.safeParse({ ...electric, meterNumber: undefined }).success).toBe(false);
  });

  it("rejects non-integer cents and extra fields", () => {
    expect(ParsedBill.safeParse({ ...electric, totalCents: 1.5 }).success).toBe(false);
    expect(ParsedBill.safeParse({ ...electric, savingsCents: 1 }).success).toBe(false);
  });

  it("converts to a JSON schema with every field required and every object closed", () => {
    const schema = z.toJSONSchema(ParsedBill) as { required: string[] };
    expect(schema.required).toEqual(Object.keys(ParsedBill.shape));
    expect(closedObjects(schema)).toBe(true);
  });
});
