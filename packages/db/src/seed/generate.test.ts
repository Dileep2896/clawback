import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eligibleSchedules } from "@bill-fighter/core/tariff/eligibility";
import { loadTariff } from "@bill-fighter/core/tariff/load";
import { priceUsage, roundCents } from "@bill-fighter/core/tariff/price-usage";
import { AccountFixture, BillFixture, GAS_SUPPLIER, PhoneLineFixture } from "@bill-fighter/shared/fixtures";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_MONTH, LAST_MONTH, METER_SWAP, STORES } from "./customer.ts";
import { calendarMonth, generateSeed, monthsBetween, writeSeed, type Seed } from "./generate.ts";

const SLOW = 180_000;
const YEAR = monthsBetween(FIRST_MONTH, LAST_MONTH);
const FIRST_DAY_OF_YEAR = calendarMonth(FIRST_MONTH).start;
const PACIFIC_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });

let seed: Seed;
let json: string;

const billsOf = (accountId: string) => seed.bills.filter((b) => b.accountId === accountId);

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  seed = generateSeed();
  json = JSON.stringify(seed);
}, SLOW);

describe("monthsBetween and calendarMonth", () => {
  it("crosses a year and handles a leap February", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(calendarMonth("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
});

describe("generateSeed", () => {
  it("gives identical bytes on a later date, pinned so drift fails", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2031-03-15T12:00:00Z") });
    try {
      expect(JSON.stringify(generateSeed())).toBe(json);
    } finally {
      vi.useRealTimers();
    }
    // Changes on a tariff refresh, on purpose: data/parsed/ is then stale and bills need reparsing.
    expect(createHash("sha256").update(json).digest("hex")).toBe("47feb9b66d4a7079f94bac43d3e953e5fb015b90ed396f73b3312e70c4b732c9");
  }, SLOW);

  it("creates 12 locations, 37 accounts and 448 bills", () => {
    expect(seed.locations).toHaveLength(12);
    expect(seed.accounts).toHaveLength(37);
    expect(seed.bills).toHaveLength(448);
    expect(new Set(seed.bills.map((b) => b.id)).size).toBe(448);
    const cities = seed.locations.map((l) => l.city);
    expect(cities.filter((c) => c === "San Francisco")).toHaveLength(4);
    expect(cities.filter((c) => c === "Oakland")).toHaveLength(3);
    expect(cities.filter((c) => c === "San Jose")).toHaveLength(3);
    expect(cities.filter((c) => c === "Fremont")).toHaveLength(2);
  });

  it("gives every account 12 calendar months ending October 2026, except Fremont #1 electric at 16", () => {
    for (const account of seed.accounts) {
      const months = billsOf(account.id).map((b) => b.periodStart.slice(0, 7));
      expect(months).toEqual(
        account.id === "fremont-1-electric" ? monthsBetween(METER_SWAP.firstMonth, LAST_MONTH) : YEAR,
      );
    }
    for (const bill of seed.bills) expect(bill.periodEnd).toBe(calendarMonth(bill.periodStart.slice(0, 7)).end);
  });

  it("keeps electric intervals to the billed window, with ts as the interval start", () => {
    expect(Object.keys(seed.intervals)).toHaveLength(12);
    for (const [accountId, rows] of Object.entries(seed.intervals)) {
      const first = accountId === "fremont-1-electric" ? "2025-07-01T07:00:00.000Z" : "2025-11-01T07:00:00.000Z";
      expect(rows[0]!.ts).toBe(first);
      expect(rows.at(-1)!.ts).toBe("2026-11-01T06:45:00.000Z");
    }
  });

  it("gives bills whose lines add up and whose quantities times rates match", () => {
    for (const bill of seed.bills) {
      expect(bill.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(bill.totalCents);
      expect(new Set(bill.kwhByTouPeriod.map((p) => p.period)).size).toBe(bill.kwhByTouPeriod.length);
      for (const line of bill.lines) {
        if (line.lineType === "energy") {
          expect(Math.abs(line.quantity! * line.rate! - line.amountCents / 100)).toBeLessThanOrEqual(line.amountCents / 10000);
        }
        // Would fail for a prorated line. Seed bills are calendar months, so none is.
        if (line.lineType === "demand") expect(roundCents(line.quantity! * line.rate!)).toBe(line.amountCents);
      }
    }
    expect(seed.bills.some((b) => b.lines.some((l) => l.lineType === "demand"))).toBe(true);
  });

  it("writes files that read back the same", () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-"));
    try {
      writeSeed(seed, pathToFileURL(`${dir}/`));
      const { accounts } = JSON.parse(readFileSync(join(dir, "customer.json"), "utf8")) as Seed;
      expect(accounts).toEqual(seed.accounts);
      expect(JSON.parse(readFileSync(join(dir, "bills.json"), "utf8"))).toEqual(seed.bills);
      expect(readdirSync(join(dir, "intervals"))).toHaveLength(12);
      expect(JSON.parse(readFileSync(join(dir, "intervals", "oakland-1-electric.json"), "utf8"))).toEqual(
        seed.intervals["oakland-1-electric"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("holds annual spend within 10% of $300,000 over the last 12 months", () => {
    const cents = seed.bills.filter((b) => b.periodStart >= FIRST_DAY_OF_YEAR).reduce((sum, b) => sum + b.totalCents, 0);
    expect(cents).toBeGreaterThanOrEqual(27_000_000);
    expect(cents).toBeLessThanOrEqual(33_000_000);
  });
});

describe("Fremont #1 meter", () => {
  const swap = METER_SWAP.swapMonth;

  it("changes meter number and multiplier from 1 to 2 at the swap", () => {
    const bills = billsOf("fremont-1-electric");
    const before = bills.filter((b) => b.periodStart.slice(0, 7) < swap);
    const after = bills.filter((b) => b.periodStart.slice(0, 7) >= swap);
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(14);
    expect(new Set(before.map((b) => `${b.meterNumber} x${b.multiplier}`))).toEqual(new Set([`${METER_SWAP.oldMeter} x1`]));
    const account = seed.accounts.find((a) => a.id === "fremont-1-electric")!;
    expect(account.meterNumber).not.toBe(METER_SWAP.oldMeter);
    expect(new Set(after.map((b) => `${b.meterNumber} x${b.multiplier}`))).toEqual(new Set([`${account.meterNumber} x2`]));
  });

  it("bills exactly 2.0 x interval kWh after the swap and 1.0 x before, per TOU period and by raw rows", () => {
    const intervals = seed.intervals["fremont-1-electric"]!;
    const tariff = loadTariff("B-6");
    const rawKwhByMonth = new Map<string, number>();
    for (const { ts, kwh } of intervals) {
      const month = PACIFIC_DATE.format(new Date(ts)).slice(0, 7);
      rawKwhByMonth.set(month, (rawKwhByMonth.get(month) ?? 0) + kwh);
    }
    for (const bill of billsOf("fremont-1-electric")) {
      const month = bill.periodStart.slice(0, 7);
      const factor = month >= swap ? 2 : 1;
      const metered = priceUsage(intervals, tariff, { start: bill.periodStart, end: bill.periodEnd });
      expect(bill.kwhByTouPeriod).toEqual(
        metered.energy.map(({ period, kwh }) => ({ period, kwh: Number((kwh * factor).toFixed(3)) })),
      );
      const billedKwh = bill.kwhByTouPeriod.reduce((sum, p) => sum + p.kwh, 0);
      expect(billedKwh).toBeCloseTo(rawKwhByMonth.get(month)! * factor, 2);
    }
  }, SLOW);

  it("sits on a schedule where the bill is mostly energy", () => {
    const account = seed.accounts.find((a) => a.id === "fremont-1-electric")!;
    expect(account.rateSchedule).toBe("B-6");
    for (const bill of billsOf(account.id)) {
      const energyCents = bill.lines.filter((l) => l.lineType === "energy").reduce((sum, l) => sum + l.amountCents, 0);
      expect(energyCents / bill.totalCents).toBeGreaterThan(0.95);
      expect(bill.lines.some((l) => l.lineType === "demand")).toBe(false);
    }
  });
});

describe("rate schedules", () => {
  it("has Oakland #1 and #2 on B-10 with about 40 kW and a lunch-heavy load", () => {
    for (const id of ["oakland-1-electric", "oakland-2-electric"]) {
      expect(seed.accounts.find((a) => a.id === id)!.rateSchedule).toBe("B-10");
      const maxKw = Math.max(...billsOf(id).map((b) => b.maxKw!));
      expect(maxKw).toBeGreaterThan(38);
      expect(maxKw).toBeLessThan(42);
      const peak = seed.intervals[id]!.reduce((best, i) => (i.kwh > best.kwh ? i : best));
      const hour = Number(new Date(peak.ts).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }));
      expect(hour).toBeGreaterThanOrEqual(11);
      expect(hour).toBeLessThan(14);
    }
  });

  // A store more than 2% off its cheapest schedule would be a false rateOptimization finding. Priced from true usage.
  it("leaves every other store within 2% of its cheapest eligible schedule", () => {
    for (const store of STORES.filter((s) => s.id !== "oakland-1" && s.id !== "oakland-2")) {
      const intervals = seed.intervals[`${store.id}-electric`]!;
      const price = (schedule: Parameters<typeof loadTariff>[0]) => {
        const tariff = loadTariff(schedule);
        return YEAR.map((month) => priceUsage(intervals, tariff, calendarMonth(month)));
      };
      const current = price(store.schedule);
      const currentCents = current.reduce((sum, b) => sum + b.totalCents, 0);
      const maxKw = Math.max(...current.map((b) => b.maxKw));
      for (const schedule of eligibleSchedules(maxKw)) {
        const otherCents = price(schedule).reduce((sum, b) => sum + b.totalCents, 0);
        expect(1 - otherCents / currentCents, `${store.id} on ${store.schedule} vs ${schedule}`).toBeLessThanOrEqual(0.02);
      }
    }
  }, SLOW);
});

describe("phone lines", () => {
  const pots = () => seed.phoneLines.filter((l) => l.purpose !== "voice");

  it("has nine POTS lines across six stores at $60", () => {
    expect(pots()).toHaveLength(9);
    expect(new Set(pots().map((l) => l.accountId)).size).toBe(6);
    for (const line of pots()) expect(line.monthlyCents).toBe(6000);
  });

  it("has seven with zero calls and two alarm lines with low use", () => {
    const alarms = pots().filter((l) => l.purpose === "alarm");
    expect(alarms).toHaveLength(2);
    for (const alarm of alarms) {
      expect(alarm.callsLast12mo).toBeGreaterThan(0);
      expect(alarm.callsLast12mo).toBeLessThan(20);
    }
    expect(pots().filter((l) => l.purpose !== "alarm" && l.callsLast12mo === 0)).toHaveLength(7);
  });

  it("gives every store a used voice line, and every number is unique", () => {
    const voice = seed.phoneLines.filter((l) => l.purpose === "voice");
    expect(voice).toHaveLength(12);
    for (const line of voice) expect(line.callsLast12mo).toBeGreaterThan(100);
    expect(new Set(seed.phoneLines.map((l) => l.number)).size).toBe(seed.phoneLines.length);
  });

  it("bills each phone line every month", () => {
    for (const account of seed.accounts.filter((a) => a.serviceType === "telecom")) {
      const lines = seed.phoneLines.filter((l) => l.accountId === account.id);
      const monthlyCents = lines.reduce((sum, l) => sum + l.monthlyCents, 0);
      for (const bill of billsOf(account.id)) {
        expect(bill.lines).toHaveLength(lines.length);
        expect(bill.totalCents).toBe(monthlyCents);
        for (const line of lines) expect(bill.lines.some((l) => l.description.includes(line.number))).toBe(true);
      }
    }
  });
});

describe("BayConnect", () => {
  it("jumps three accounts from $95 to $185 inside the window on the same plan code", () => {
    const internet = seed.accounts.filter((a) => a.serviceType === "internet");
    expect(internet).toHaveLength(12);
    expect(internet.every((a) => a.provider === "bayconnect")).toBe(true);
    const jumped = internet.filter((a) => new Set(billsOf(a.id).map((b) => b.totalCents)).size > 1);
    expect(jumped).toHaveLength(3);
    for (const account of jumped) {
      const bills = billsOf(account.id);
      expect(new Set(bills.map((b) => b.planCode)).size).toBe(1);
      expect(bills[0]!.totalCents).toBe(9500);
      const firstLater = bills.findIndex((b) => b.totalCents === 18500);
      expect(firstLater).toBeGreaterThan(0);
      expect(bills.slice(firstLater).every((b) => b.totalCents === 18500)).toBe(true);
      expect(bills.every((b) => b.kwhByTouPeriod.length === 0 && b.lines.length === 1)).toBe(true);
    }
    for (const account of internet.filter((a) => !jumped.includes(a))) {
      expect(billsOf(account.id).every((b) => b.totalCents === 9500)).toBe(true);
    }
  });
});

describe("gas", () => {
  it("has one BayHearth account at Oakland #3, with 12 bills", () => {
    const gas = seed.accounts.filter((a) => a.serviceType === "gas");
    expect(gas).toHaveLength(1);
    expect(gas[0]!.provider).toBe(GAS_SUPPLIER.provider);
    expect(gas[0]!.locationId).toBe("oakland-3");
    expect(billsOf(gas[0]!.id)).toHaveLength(12);
  });
});

describe("no answers in the fixtures", () => {
  it("passes the strict schemas, which reject any extra field", () => {
    for (const account of seed.accounts) expect(() => AccountFixture.parse(account)).not.toThrow();
    for (const bill of seed.bills) expect(() => BillFixture.parse(bill)).not.toThrow();
    for (const line of seed.phoneLines) expect(() => PhoneLineFixture.parse(line)).not.toThrow();
    expect(() => BillFixture.parse({ ...seed.bills[0], annualSavingsCents: 1 })).toThrow();
  });

  it("contains no finding or savings figure in any key or value", () => {
    // savingsSharePct is the fee share on the customer row, not a result. Intervals are checked by key below.
    const text = JSON.stringify({ ...seed, intervals: undefined, customer: { ...seed.customer, savingsSharePct: undefined } });
    expect(text).not.toMatch(/finding|saving|refund|overbill|overcharg|expected|planted|promo|expired|decoy|error|wrong/i);
    expect(Object.keys(seed.intervals["sf-1-electric"]![0]!).sort()).toEqual(["accountId", "kwh", "ts"]);
  });
});
