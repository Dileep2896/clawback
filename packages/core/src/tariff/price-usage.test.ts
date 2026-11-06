import { Tariff } from "@bill-fighter/shared/tariff";
import { describe, expect, it } from "vitest";
import { type Interval, priceUsage, roundCents } from "./price-usage.ts";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const PST_MS = 8 * 60 * 60 * 1000;

const grid = (fill: (month: number, hour: number) => number) =>
  Array.from({ length: 12 }, (_, month) => Array.from({ length: 24 }, (_, hour) => fill(month, hour)));

const BASE = {
  schedule: "B-10",
  source: "urdb",
  sourceId: "test",
  effectiveStart: "2026-01-01",
  updatedAt: "2026-01-01",
  energyWeekdaySchedule: grid(() => 0),
  energyWeekendSchedule: grid(() => 0),
  energyPeriods: [{ name: "flat", tiers: [{ upToKwh: null, usdPerKwh: 1 }] }],
  demandWeekdaySchedule: null,
  demandWeekendSchedule: null,
  demandPeriods: [],
  flatDemandMonths: null,
  flatDemandPeriods: [],
  fixedCharges: [],
};
const tariff = (overrides: object) => Tariff.parse({ ...BASE, ...overrides });

const PEAK_HOURS = (hour: number) => (hour >= 16 && hour <= 20 ? 1 : 0);
const TWO_PRICE = {
  energyWeekdaySchedule: grid((_, hour) => PEAK_HOURS(hour)),
  energyWeekendSchedule: grid(() => 0),
  energyPeriods: [
    { name: "off-peak", tiers: [{ upToKwh: null, usdPerKwh: 1 }] },
    { name: "peak", tiers: [{ upToKwh: null, usdPerKwh: 2 }] },
  ],
};

// Every 15 minute interval of a PST month, with kwh chosen from the Pacific time of the interval.
function pstIntervals(start: string, count: number, kwh: (pacific: Date) => number): Interval[] {
  const first = Date.parse(`${start}T00:00:00-08:00`);
  return Array.from({ length: count }, (_, i) => {
    const ms = first + i * FIFTEEN_MINUTES;
    return { ts: new Date(ms), kwh: kwh(new Date(ms - PST_MS)) };
  });
}

const kwhByName = (bill: ReturnType<typeof priceUsage>) =>
  Object.fromEntries(bill.energy.map((e) => [e.period, e.kwh]));

describe("priceUsage hand-computed bills", () => {
  it("prices a flat load to the cent", () => {
    // Jan 2026: 31 days x 96 = 2976 intervals x 0.5 kWh = 1488 kWh, 2 kW.
    // Energy 1488 x 0.25 = 372.00. Flat demand 2 x 3.25 = 6.50. Fixed 31 x 4.92 = 152.52.
    // Total 531.02.
    const bill = priceUsage(
      pstIntervals("2026-01-01", 31 * 96, () => 0.5),
      tariff({
        energyPeriods: [{ name: "flat", tiers: [{ upToKwh: null, usdPerKwh: 0.25 }] }],
        flatDemandMonths: Array(12).fill(0),
        flatDemandPeriods: [{ name: "max", tiers: [{ upToKw: null, usdPerKw: 3.25 }] }],
        fixedCharges: [{ name: "Customer", usd: 4.92, per: "day" }],
      }),
      { start: "2026-01-01", end: "2026-01-31" },
    );
    expect(bill).toMatchObject({
      energyCents: 37200,
      demandCents: 650,
      fixedCents: 15252,
      totalCents: 53102,
      maxKw: 2,
    });
  });

  // Feb 2026 starts on a Sunday: 28 days, 20 weekdays, 2688 intervals. Weekday 16:00 to 20:59 is peak,
  // which is 20 x 5 x 4 = 400 intervals. The load is 0.25 kWh off-peak and 0.5 kWh on peak, plus:
  //   Wed Feb 11 17:00 peak spike of 2.5 kWh (10 kW), Sat Feb 14 12:00 off-peak spike of 3 kWh (12 kW).
  //
  // Peak kWh     399 x 0.5 + 2.5 = 202           x 0.40123 = 81.04846 -> 81.05
  // Off-peak kWh 2287 x 0.25 + 3 = 574.75
  //   first 500 x 0.20 = 100.00
  //   next 74.75 x 0.30 = 22.425 -> 22.43 (half cent rounds up)
  // Energy 81.05 + 100.00 + 22.43 = 203.48
  //
  // Peak demand 10 kW: 5 x 10 + 5 x 12 = 110.00
  // Off-peak demand 12 kW x 1.10 = 13.20
  // Flat demand 12 kW x 3.25 = 39.00
  // Demand 162.20
  //
  // Fixed 28 x 4.92 = 137.76, plus 10.01 a month = 147.77
  // Total 203.48 + 162.20 + 147.77 = 513.45
  const touBill = (source: string) =>
    priceUsage(
      pstIntervals("2026-02-01", 28 * 96, (t) => {
        const [date, hour, minute, day] = [t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCDay()];
        if (date === 11 && hour === 17 && minute === 0) return 2.5;
        if (date === 14 && hour === 12 && minute === 0) return 3;
        return day !== 0 && day !== 6 && PEAK_HOURS(hour) === 1 ? 0.5 : 0.25;
      }),
      tariff({
        source,
        energyWeekdaySchedule: grid((_, hour) => PEAK_HOURS(hour)),
        energyWeekendSchedule: grid(() => 0),
        energyPeriods: [
          {
            name: "off-peak",
            tiers: [
              { upToKwh: 500, usdPerKwh: 0.2 },
              { upToKwh: null, usdPerKwh: 0.3 },
            ],
          },
          { name: "peak", tiers: [{ upToKwh: null, usdPerKwh: 0.40123 }] },
        ],
        demandWeekdaySchedule: grid((_, hour) => PEAK_HOURS(hour)),
        demandWeekendSchedule: grid(() => 0),
        demandPeriods: [
          { name: "off-peak", tiers: [{ upToKw: null, usdPerKw: 1.1 }] },
          {
            name: "peak",
            tiers: [
              { upToKw: 5, usdPerKw: 10 },
              { upToKw: null, usdPerKw: 12 },
            ],
          },
        ],
        flatDemandMonths: Array(12).fill(0),
        flatDemandPeriods: [{ name: "max", tiers: [{ upToKw: null, usdPerKw: 3.25 }] }],
        fixedCharges: [
          { name: "Customer", usd: 4.92, per: "day" },
          { name: "Meter", usd: 10.01, per: "month" },
        ],
      }),
      { start: "2026-02-01", end: "2026-02-28" },
    );

  it.each(["urdb", "fallback"])("prices a TOU bill to the cent on a %s tariff", (source) => {
    const bill = touBill(source);
    expect(bill.totalCents).toBe(51345);
    expect(bill.energyCents).toBe(20348);
    expect(bill.demandCents).toBe(16220);
    expect(bill.fixedCents).toBe(14777);
    expect(bill.maxKw).toBe(12);
  });

  it("itemizes the TOU bill", () => {
    const bill = touBill("urdb");
    expect(bill.energy).toEqual([
      {
        period: "off-peak",
        kwh: 574.75,
        cents: 12243,
        tiers: [
          { kwh: 500, usdPerKwh: 0.2, cents: 10000 },
          { kwh: 74.75, usdPerKwh: 0.3, cents: 2243 },
        ],
      },
      { period: "peak", kwh: 202, cents: 8105, tiers: [{ kwh: 202, usdPerKwh: 0.40123, cents: 8105 }] },
    ]);
    expect(bill.demand).toEqual([
      { period: "off-peak", kind: "tou", maxKw: 12, days: 28, cents: 1320, tiers: [{ kw: 12, usdPerKw: 1.1, cents: 1320 }] },
      {
        period: "peak",
        kind: "tou",
        maxKw: 10,
        days: 28,
        cents: 11000,
        tiers: [
          { kw: 5, usdPerKw: 10, cents: 5000 },
          { kw: 5, usdPerKw: 12, cents: 6000 },
        ],
      },
      { period: "max", kind: "flat", maxKw: 12, days: 28, cents: 3900, tiers: [{ kw: 12, usdPerKw: 3.25, cents: 3900 }] },
    ]);
    expect(bill.fixed).toEqual([
      { name: "Customer", cents: 13776 },
      { name: "Meter", cents: 1001 },
    ]);
  });
});

describe("priceUsage period mapping", () => {
  it("uses the weekday grid Monday to Friday and the weekend grid otherwise", () => {
    const bill = priceUsage(
      [
        { ts: "2026-01-02T16:00:00-08:00", kwh: 1 }, // Friday
        { ts: "2026-01-03T16:00:00-08:00", kwh: 2 }, // Saturday
        { ts: "2026-01-04T16:00:00-08:00", kwh: 4 }, // Sunday
        { ts: "2026-01-05T16:00:00-08:00", kwh: 8 }, // Monday
      ],
      tariff(TWO_PRICE),
      { start: "2026-01-01", end: "2026-01-31" },
    );
    expect(kwhByName(bill)).toEqual({ "off-peak": 6, peak: 9 });
  });

  it("treats ts as the interval start, so 15:45 is before a 16:00 peak and 16:00 is inside it", () => {
    const bill = priceUsage(
      [
        { ts: "2026-01-05T15:45:00-08:00", kwh: 1 },
        { ts: "2026-01-05T16:00:00-08:00", kwh: 2 },
        { ts: "2026-01-05T20:45:00-08:00", kwh: 4 },
        { ts: "2026-01-05T21:00:00-08:00", kwh: 8 },
      ],
      tariff(TWO_PRICE),
      { start: "2026-01-01", end: "2026-01-31" },
    );
    expect(kwhByName(bill)).toEqual({ "off-peak": 9, peak: 6 });
  });

  it("puts each side of a month boundary on its own month's grid row, and drops what is outside", () => {
    const byMonth = tariff({
      ...TWO_PRICE,
      energyWeekdaySchedule: grid((month) => (month === 0 ? 0 : 1)),
      energyWeekendSchedule: grid((month) => (month === 0 ? 0 : 1)),
    });
    const bill = priceUsage(
      [
        { ts: "2026-01-30T23:45:00-08:00", kwh: 1 }, // before the period
        { ts: "2026-01-31T23:45:00-08:00", kwh: 2 }, // January
        { ts: "2026-02-01T00:00:00-08:00", kwh: 4 }, // February
        { ts: "2026-02-01T23:45:00-08:00", kwh: 8 }, // last interval inside the period
        { ts: "2026-02-02T00:00:00-08:00", kwh: 16 }, // after the period
      ],
      byMonth,
      { start: "2026-01-31", end: "2026-02-01" },
    );
    expect(kwhByName(bill)).toEqual({ "off-peak": 2, peak: 12 });
  });

  it("uses Pacific time, not UTC, at a month boundary", () => {
    const byMonth = tariff({
      ...TWO_PRICE,
      energyWeekdaySchedule: grid((month) => (month === 0 ? 0 : 1)),
      energyWeekendSchedule: grid((month) => (month === 0 ? 0 : 1)),
    });
    // 07:45 UTC on Feb 1 is still 23:45 on Jan 31 in Pacific time.
    const bill = priceUsage([{ ts: "2026-02-01T07:45:00Z", kwh: 1 }], byMonth, {
      start: "2026-01-31",
      end: "2026-01-31",
    });
    expect(kwhByName(bill)).toEqual({ "off-peak": 1 });
  });

  it("prices the same instant the same whatever form its timestamp takes", () => {
    const instants = [
      "2026-07-01T16:00:00-07:00",
      "2026-07-01T23:00:00Z",
      "2026-07-01T15:00:00-08:00",
      new Date("2026-07-01T23:00:00Z"),
    ];
    for (const ts of instants) {
      const bill = priceUsage([{ ts, kwh: 1 }], tariff(TWO_PRICE), { start: "2026-07-01", end: "2026-07-01" });
      expect(kwhByName(bill)).toEqual({ peak: 1 });
    }
  });

  it("follows daylight saving, so 23:00 UTC is 15:00 before the change and 16:00 after", () => {
    // Clocks went forward on Sunday Mar 8 2026. Both days below are weekdays.
    const bill = priceUsage(
      [
        { ts: "2026-03-06T23:00:00Z", kwh: 1 },
        { ts: "2026-03-09T23:00:00Z", kwh: 2 },
      ],
      tariff(TWO_PRICE),
      { start: "2026-03-01", end: "2026-03-31" },
    );
    expect(kwhByName(bill)).toEqual({ "off-peak": 1, peak: 2 });
  });
});

describe("priceUsage demand", () => {
  const withDemand = tariff({
    demandWeekdaySchedule: grid((_, hour) => PEAK_HOURS(hour)),
    demandWeekendSchedule: grid(() => 0),
    demandPeriods: [
      { name: "off-peak", tiers: [{ upToKw: null, usdPerKw: 1 }] },
      { name: "peak", tiers: [{ upToKw: null, usdPerKw: 10 }] },
    ],
  });

  it("takes max kW as 15 minute kWh x 4, separately per demand window", () => {
    const bill = priceUsage(
      [
        { ts: "2026-01-05T12:00:00-08:00", kwh: 2.5 },
        { ts: "2026-01-05T12:15:00-08:00", kwh: 1 },
        { ts: "2026-01-05T17:00:00-08:00", kwh: 0.5 },
        { ts: "2026-01-05T17:15:00-08:00", kwh: 0.75 },
      ],
      withDemand,
      { start: "2026-01-05", end: "2026-01-05" },
    );
    expect(bill.demand.map((d) => [d.period, d.maxKw])).toEqual([
      ["off-peak", 10],
      ["peak", 3],
    ]);
    expect(bill.demandCents).toBe(1000 + 3000);
    expect(bill.maxKw).toBe(10);
  });

  it("charges no demand when the tariff has none", () => {
    const bill = priceUsage([{ ts: "2026-01-05T12:00:00-08:00", kwh: 100 }], tariff({}), {
      start: "2026-01-05",
      end: "2026-01-05",
    });
    expect(bill.demand).toEqual([]);
    expect(bill.demandCents).toBe(0);
    expect(bill.maxKw).toBe(400);
  });
});

describe("priceUsage across a season change", () => {
  // Summer is June to September. Winter demand is $10/kW and summer demand is $20/kW.
  const SEASON = (month: number) => (month >= 5 && month <= 8 ? 1 : 0);
  const seasonal = {
    energyWeekdaySchedule: grid(SEASON),
    energyWeekendSchedule: grid(SEASON),
    energyPeriods: [
      { name: "winter", tiers: [{ upToKwh: null, usdPerKwh: 0.2 }] },
      { name: "summer", tiers: [{ upToKwh: null, usdPerKwh: 0.3 }] },
    ],
    demandWeekdaySchedule: grid(SEASON),
    demandWeekendSchedule: grid(SEASON),
    demandPeriods: [
      { name: "winter", tiers: [{ upToKw: null, usdPerKw: 10 }] },
      { name: "summer", tiers: [{ upToKw: null, usdPerKw: 20 }] },
    ],
    fixedCharges: [
      { name: "Daily", usd: 1, per: "day" },
      { name: "Monthly", usd: 7, per: "month" },
    ],
  };

  it("prorates seasonal demand by days across June 1, and leaves year-round demand whole", () => {
    // May 16 to Jun 15 is 31 days: 16 in winter and 15 in summer.
    // Energy 2.5 x 0.20 + 5 x 0.30 = 2.00
    // Winter demand 10 kW x 10 x 16/31 = 51.6129 -> 51.61
    // Summer demand 20 kW x 20 x 15/31 = 193.5484 -> 193.55
    // Year-round demand 20 kW x 3 = 60.00, the whole bill's max with no proration
    // Fixed 31 x 1 + 7 = 38.00
    // Total 2.00 + 305.16 + 38.00 = 345.16
    const bill = priceUsage(
      [
        { ts: "2026-05-20T12:00:00-07:00", kwh: 2.5 },
        { ts: "2026-06-10T12:00:00-07:00", kwh: 5 },
      ],
      tariff({
        ...seasonal,
        flatDemandMonths: Array(12).fill(0),
        flatDemandPeriods: [{ name: "max", tiers: [{ upToKw: null, usdPerKw: 3 }] }],
      }),
      { start: "2026-05-16", end: "2026-06-15" },
    );
    expect(bill.demand.map((d) => [d.period, d.maxKw, d.days, d.cents])).toEqual([
      ["winter", 10, 16, 5161],
      ["summer", 20, 15, 19355],
      ["max", 20, 31, 6000],
    ]);
    expect(bill.energyCents).toBe(200);
    expect(bill.demandCents).toBe(30516);
    expect(bill.fixed).toEqual([
      { name: "Daily", cents: 3100 },
      { name: "Monthly", cents: 700 },
    ]);
    expect(bill.totalCents).toBe(34516);
  });

  it("splits at October 1, with each side of midnight in its own season", () => {
    // Sep 16 to Oct 15 is 30 days: 15 in each season.
    // Energy 5 x 0.30 + 2.5 x 0.20 = 2.00
    // Summer demand 20 kW x 20 x 15/30 = 200.00. Winter demand 10 kW x 10 x 15/30 = 50.00.
    // Fixed 30 x 1 + 7 = 37.00. Total 289.00.
    const bill = priceUsage(
      [
        { ts: "2026-09-30T23:45:00-07:00", kwh: 5 },
        { ts: "2026-10-01T00:00:00-07:00", kwh: 2.5 },
      ],
      tariff(seasonal),
      { start: "2026-09-16", end: "2026-10-15" },
    );
    expect(bill.demand.map((d) => [d.period, d.maxKw, d.days, d.cents])).toEqual([
      ["winter", 10, 15, 5000],
      ["summer", 20, 15, 20000],
    ]);
    expect(bill.energy.map((e) => [e.period, e.kwh])).toEqual([
      ["winter", 2.5],
      ["summer", 5],
    ]);
    expect(bill.totalCents).toBe(28900);
  });

  it("does not prorate a bill that crosses a month but stays in one season", () => {
    const bill = priceUsage([{ ts: "2026-01-20T12:00:00-08:00", kwh: 2.5 }], tariff(seasonal), {
      start: "2026-01-15",
      end: "2026-02-14",
    });
    expect(bill.demand.map((d) => [d.period, d.days, d.cents])).toEqual([["winter", 31, 10000]]);
  });

  it("charges no demand for a season with no usage on the bill", () => {
    const bill = priceUsage([{ ts: "2026-05-20T12:00:00-07:00", kwh: 2.5 }], tariff(seasonal), {
      start: "2026-05-16",
      end: "2026-06-15",
    });
    expect(bill.demand.map((d) => d.period)).toEqual(["winter"]);
  });
});

describe("priceUsage fixed charges and period", () => {
  const fixedOnly = tariff({
    fixedCharges: [
      { name: "Daily", usd: 1, per: "day" },
      { name: "Monthly", usd: 7, per: "month" },
    ],
  });

  it("counts both ends of the period and bills a month charge once", () => {
    const bill = priceUsage([], fixedOnly, { start: "2026-01-15", end: "2026-02-14" });
    expect(bill.fixed).toEqual([
      { name: "Daily", cents: 3100 },
      { name: "Monthly", cents: 700 },
    ]);
    expect(bill.totalCents).toBe(3800);
    expect(bill.energy).toEqual([]);
    expect(bill.maxKw).toBe(0);
  });

  it("counts whole days across a daylight saving change", () => {
    expect(priceUsage([], fixedOnly, { start: "2026-03-01", end: "2026-03-31" }).fixed[0]!.cents).toBe(3100);
    expect(priceUsage([], fixedOnly, { start: "2026-11-01", end: "2026-11-01" }).fixed[0]!.cents).toBe(100);
  });

  it("rejects a period that ends before it starts or is not a date", () => {
    expect(() => priceUsage([], fixedOnly, { start: "2026-02-01", end: "2026-01-31" })).toThrow(/Bad billing period/);
    expect(() => priceUsage([], fixedOnly, { start: "soon", end: "2026-01-31" })).toThrow(/Bad billing period/);
  });

  it("rejects an interval timestamp it cannot read", () => {
    expect(() =>
      priceUsage([{ ts: "not a time", kwh: 1 }], fixedOnly, { start: "2026-01-01", end: "2026-01-31" }),
    ).toThrow(RangeError);
  });
});

describe("roundCents", () => {
  it.each([
    [0.124, 12],
    [0.125, 13],
    [0.126, 13],
    [1.005, 101],
    [22.425, 2243],
    [-0.125, -13],
    [-1.005, -101],
    [-0.124, -12],
    [0, 0],
  ])("rounds %d dollars to %d cents, half away from zero", (usd, cents) => {
    expect(roundCents(usd)).toBe(cents);
  });

  it("never returns negative zero", () => {
    expect(Object.is(roundCents(-0.001), 0)).toBe(true);
  });

  it("gives integer lines that sum exactly to the total, including a credit", () => {
    const bill = priceUsage(
      pstIntervals("2026-01-01", 96, (t) => 0.1 + t.getUTCHours() / 997),
      tariff({
        energyPeriods: [{ name: "flat", tiers: [{ upToKwh: 1.7, usdPerKwh: 0.28713 }, { upToKwh: null, usdPerKwh: 0.31357 }] }],
        fixedCharges: [
          { name: "Customer", usd: 0.33333, per: "day" },
          { name: "Credit", usd: -1.015, per: "month" },
        ],
      }),
      { start: "2026-01-01", end: "2026-01-01" },
    );
    const lines = [
      ...bill.energy.flatMap((e) => e.tiers.map((t) => t.cents)),
      ...bill.fixed.map((f) => f.cents),
    ];
    expect(lines.every(Number.isInteger)).toBe(true);
    expect(lines.reduce((a, b) => a + b, 0)).toBe(bill.totalCents);
    expect(bill.fixed[1]!.cents).toBe(-102);
  });
});
