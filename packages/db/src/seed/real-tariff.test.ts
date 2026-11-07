import { eligibleSchedules } from "@bill-fighter/core/tariff/eligibility";
import { loadTariff } from "@bill-fighter/core/tariff/load";
import { priceUsage } from "@bill-fighter/core/tariff/price-usage";
import type { RateSchedule } from "@bill-fighter/shared/tariff";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_MONTH, LAST_MONTH, STORES } from "./customer.ts";
import { calendarMonth, monthsBetween } from "./generate.ts";
import { loadProfile } from "./load-profile.ts";

const SLOW = 180_000;
const SCHEDULES: RateSchedule[] = ["B-1", "B-6", "B-10", "B-19"];
const YEAR = monthsBetween(FIRST_MONTH, LAST_MONTH);

function priceYear(seed: string, monthlyKwh: number, lunchKw: number, schedule: RateSchedule) {
  const intervals = loadProfile({
    seed,
    start: calendarMonth(FIRST_MONTH).start,
    end: calendarMonth(LAST_MONTH).end,
    monthlyKwh,
    lunchKw,
  });
  const tariff = loadTariff(schedule);
  return YEAR.map((month) => priceUsage(intervals, tariff, calendarMonth(month)));
}
const annualCents = (bills: { totalCents: number }[]) => bills.reduce((sum, b) => sum + b.totalCents, 0);

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("loadTariff sources", () => {
  it("uses URDB for B-6 and the fallback for B-1, B-10 and B-19", () => {
    expect(loadTariff("B-6").source).toBe("urdb");
    for (const schedule of ["B-1", "B-10", "B-19"] as const) expect(loadTariff(schedule).source).toBe("fallback");
  });
});

// A failure here means the rate finding changed. Report it: at 2% or under the finding drops, and inputs are not tuned to rescue it.
describe("Oakland on real tariffs", () => {
  const oakland = STORES.find((s) => s.id === "oakland-1")!;
  const CASES: [string, number, number][] = [
    ["low end of the approved range", 7000, 25],
    ["high end of the approved range", 7250, 26],
    ["the seeded store", oakland.monthlyKwh, oakland.lunchKw],
  ];

  for (const [name, monthlyKwh, lunchKw] of CASES) {
    for (const seed of ["oakland-1", "oakland-2"]) {
      it(`makes B-6 3 to 5% under B-10 over a year, and the cheapest of all: ${name}, ${seed}`, () => {
        const bills = Object.fromEntries(SCHEDULES.map((s) => [s, priceYear(seed, monthlyKwh, lunchKw, s)]));
        const cheaperPct = (1 - annualCents(bills["B-6"]!) / annualCents(bills["B-10"]!)) * 100;
        expect(cheaperPct).toBeGreaterThanOrEqual(3);
        expect(cheaperPct).toBeLessThanOrEqual(5);

        for (const schedule of SCHEDULES) expect(annualCents(bills["B-6"]!)).toBeLessThanOrEqual(annualCents(bills[schedule]!));

        const maxKw = Math.max(...bills["B-10"]!.map((b) => b.maxKw));
        expect(maxKw).toBeGreaterThan(37);
        expect(maxKw).toBeLessThan(42);
        expect(eligibleSchedules(maxKw)).toContain("B-6");
      }, SLOW);
    }
  }

  it("is an annual claim only: some single months are dearer on B-6, others much cheaper", () => {
    const six = priceYear("oakland-1", oakland.monthlyKwh, oakland.lunchKw, "B-6");
    const ten = priceYear("oakland-1", oakland.monthlyKwh, oakland.lunchKw, "B-10");
    const monthly = six.map((bill, i) => (1 - bill.totalCents / ten[i]!.totalCents) * 100);
    expect(Math.min(...monthly)).toBeLessThan(-2);
    expect(Math.max(...monthly)).toBeGreaterThan(8);
  }, SLOW);

  it("spends about $34,000 a year per store", () => {
    const usd = annualCents(priceYear("oakland-1", oakland.monthlyKwh, oakland.lunchKw, "B-10")) / 100;
    expect(usd).toBeGreaterThan(32_000);
    expect(usd).toBeLessThan(36_000);
  }, SLOW);
});

describe("Fremont #1 on real tariffs", () => {
  const fremont = STORES.find((s) => s.id === "fremont-1")!;

  it("is about $900 a month, mostly energy, on B-6", () => {
    const bills = priceYear("fremont-1", fremont.monthlyKwh, fremont.lunchKw, "B-6");
    expect(annualCents(bills) / 100 / 12).toBeGreaterThan(800);
    expect(annualCents(bills) / 100 / 12).toBeLessThan(1000);
    for (const bill of bills) {
      expect(bill.demandCents).toBe(0);
      expect(bill.energyCents / bill.totalCents).toBeGreaterThan(0.95);
    }
  }, SLOW);

  it("could not be a $900 bill on B-10, at about 40 kW", () => {
    const b10 = loadTariff("B-10");
    const customerUsdPerMonth = b10.fixedCharges.reduce((sum, c) => sum + c.usd, 0) * (365 / 12);
    const demandUsd = 40 * b10.flatDemandPeriods[0]!.tiers[0]!.usdPerKw;
    expect(customerUsdPerMonth + demandUsd).toBeGreaterThan(1100);
  });
});
