import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { priceUsage } from "@bill-fighter/core/tariff/price-usage";
import type { Tariff } from "@bill-fighter/shared/tariff";
import { describe, expect, it } from "vitest";
import { loadProfile } from "./load-profile.ts";

const DATA = new URL("../../../../data/loadprofiles/", import.meta.url);
const WINDOW = { start: "2025-07-01", end: "2026-10-31" };
const STORE = { seed: "test-store", monthlyKwh: 5000 };
const pacificHour = (ts: string) =>
  Number(new Date(ts).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }));
const total = (intervals: { kwh: number }[]) => intervals.reduce((sum, i) => sum + i.kwh, 0);

const grid = Array.from({ length: 12 }, () => Array<number>(24).fill(0));
const ONE_RATE: Tariff = {
  schedule: "B-6",
  source: "fallback",
  sourceId: "test",
  effectiveStart: "2026-03-01",
  updatedAt: "2026-03-01",
  energyWeekdaySchedule: grid,
  energyWeekendSchedule: grid,
  energyPeriods: [{ name: "All", tiers: [{ upToKwh: null, usdPerKwh: 0.1 }] }],
  demandWeekdaySchedule: null,
  demandWeekendSchedule: null,
  demandPeriods: [],
  flatDemandMonths: null,
  flatDemandPeriods: [],
  fixedCharges: [],
};

describe("loadProfile", () => {
  it("gives byte-identical output for a seed, pinned so drift between runs fails", () => {
    const options = { ...STORE, start: "2026-07-01", end: "2026-07-31", lunchKw: 20 };
    const json = JSON.stringify(loadProfile(options));
    expect(JSON.stringify(loadProfile(options))).toBe(json);
    expect(createHash("sha256").update(json).digest("hex")).toBe("bd57ef8028bc2bf524df54aef538dbcb9b57932e8ab853c2ad4aa2c50669135b");
  });

  it("gives another store different noise", () => {
    const one = { ...STORE, start: "2026-07-01", end: "2026-07-07" };
    expect(JSON.stringify(loadProfile(one))).not.toBe(JSON.stringify(loadProfile({ ...one, seed: "other-store" })));
  });

  it("covers the 16 month window every 15 minutes from Pacific midnight, with no gaps", () => {
    const intervals = loadProfile({ ...STORE, ...WINDOW });
    expect(intervals[0]!.ts).toBe("2025-07-01T07:00:00.000Z");
    expect(intervals.at(-1)!.ts).toBe("2026-11-01T06:45:00.000Z");
    for (let i = 1; i < intervals.length; i++) {
      expect(Date.parse(intervals[i]!.ts) - Date.parse(intervals[i - 1]!.ts)).toBe(900_000);
    }
  });

  it("gives daylight saving days 92 and 100 intervals", () => {
    const count = (date: string) => loadProfile({ ...STORE, start: date, end: date }).length;
    expect(count("2026-03-08")).toBe(92);
    expect(count("2025-11-02")).toBe(100);
    expect(count("2026-06-15")).toBe(96);
  });

  it("crosses a new year without losing a day", () => {
    expect(loadProfile({ ...STORE, start: "2026-12-31", end: "2027-01-01" }).length).toBe(192);
  });

  it("peaks in the Pacific lunch hours in winter and summer when given a rush", () => {
    for (const month of ["2026-01", "2026-07"]) {
      const intervals = loadProfile({ ...STORE, start: `${month}-01`, end: `${month}-31`, lunchKw: 30 });
      const peak = intervals.reduce((best, i) => (i.kwh > best.kwh ? i : best));
      expect(pacificHour(peak.ts)).toBeGreaterThanOrEqual(11);
      expect(pacificHour(peak.ts)).toBeLessThan(14);
    }
  });

  it("holds monthlyKwh over a year, with and without a rush", () => {
    const year = { start: "2025-11-01", end: "2026-10-31" };
    expect(total(loadProfile({ ...STORE, ...year })) / 12).toBeCloseTo(5000, -2);
    const withRush = total(loadProfile({ ...STORE, ...year, lunchKw: 25 })) / 12;
    expect(Math.abs(withRush - 5000) / 5000).toBeLessThan(0.02);
  });

  it("puts a day's intervals on that bill day when priced, with nothing lost at the edges", () => {
    const intervals = loadProfile({ ...STORE, start: "2026-06-30", end: "2026-08-01" });
    const july = intervals.filter((i) => Date.parse(i.ts) >= Date.parse("2026-07-01T07:00:00Z") && Date.parse(i.ts) < Date.parse("2026-08-01T07:00:00Z"));
    expect(july.length).toBe(31 * 96);
    const bill = priceUsage(intervals, ONE_RATE, { start: "2026-07-01", end: "2026-07-31" });
    expect(bill.energy[0]!.kwh).toBeCloseTo(total(july), 6);
  });

  it("refuses a bad window or a rush larger than the energy", () => {
    expect(() => loadProfile({ ...STORE, start: "2026-02-01", end: "2026-01-01" })).toThrow("Bad load profile window");
    expect(() => loadProfile({ ...STORE, start: "nope", end: "2026-01-01" })).toThrow("Bad load profile window");
    expect(() => loadProfile({ ...STORE, start: "2026-01-01", end: "2026-01-02", lunchKw: 500 })).toThrow("does not fit");
    expect(() => loadProfile({ ...STORE, start: "2026-01-01", end: "2026-01-02", lunchKw: -1 })).toThrow("does not fit");
  });
});

describe("data/loadprofiles", () => {
  it("holds the full shape, scaled so the largest value is 1", () => {
    const rows = readFileSync(new URL("comstock-alameda-fsr.csv", DATA), "utf8").trim().split("\n").slice(1);
    expect(rows).toHaveLength(12 * 2 * 96);
    expect(Math.max(...rows.map((row) => Number(row.split(",")[3])))).toBe(1);
  });

  it("records the source and its terms next to the data", () => {
    const readme = readFileSync(new URL("README.md", DATA), "utf8");
    for (const required of ["comstock_amy2018_release_2", "CC-BY-4.0", "research purposes only", "funding from the"]) {
      expect(readme).toContain(required);
    }
  });
});
