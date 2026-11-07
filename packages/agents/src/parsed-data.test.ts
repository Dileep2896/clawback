import { generateSeed } from "@bill-fighter/db/seed/generate";
import { describe, expect, it } from "vitest";
import { readParsedDir, SCHEMA_HASH } from "./parse-cache.ts";

const PARSED_DIR = new URL("../../../data/parsed", import.meta.url).pathname;

describe("committed parsed bills", () => {
  const seed = generateSeed();
  const entries = readParsedDir(PARSED_DIR);

  it("covers every seed bill exactly once, on the current schema", () => {
    expect(entries.map((e) => e.source).sort()).toEqual(seed.bills.map((b) => b.id).sort());
    expect(entries.filter((e) => e.schemaHash !== SCHEMA_HASH)).toEqual([]);
  });

  it("parsed every bill, with none left for review", () => {
    expect(entries.filter((e) => e.status !== "parsed").map((e) => `${e.source}: ${e.problems.join("; ")}`)).toEqual([]);
  });

  // A model slip that still adds up would pass validation and silently change the audit's findings.
  it("matches what the seed printed on each bill, field by field", () => {
    const mismatches = entries.flatMap((entry) => {
      const fixture = seed.bills.find((b) => b.id === entry.source);
      const account = seed.accounts.find((a) => a.id === fixture?.accountId);
      if (!fixture || !account) return [`${entry.source}: not a seed bill`];
      const { accountNumber, serviceType, meterNumber, multiplier, rateSchedule, planCode, periodStart, periodEnd, kwhByTouPeriod, maxKw, totalCents, lineItems } = entry.bill!;
      const actual = { accountNumber, serviceType, meterNumber, multiplier, rateSchedule, planCode, periodStart, periodEnd, kwhByTouPeriod, maxKw, totalCents, lines: lineItems };
      const expected = {
        accountNumber: account.accountNumber,
        serviceType: account.serviceType,
        meterNumber: fixture.meterNumber,
        multiplier: fixture.multiplier,
        rateSchedule: fixture.rateSchedule,
        planCode: fixture.planCode,
        periodStart: fixture.periodStart,
        periodEnd: fixture.periodEnd,
        kwhByTouPeriod: fixture.kwhByTouPeriod,
        maxKw: fixture.maxKw,
        totalCents: fixture.totalCents,
        lines: fixture.lines.map(({ description, quantity, unit, rate, amountCents, lineType }) => ({ description, quantity, unit, rate, amountCents, lineType })),
      };
      return (Object.keys(expected) as (keyof typeof expected)[])
        .filter((key) => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
        .map((key) => `${entry.source}.${key}: got ${JSON.stringify(actual[key])}, seed has ${JSON.stringify(expected[key])}`);
    });
    expect(mismatches).toEqual([]);
  });
});
