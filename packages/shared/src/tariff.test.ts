import { describe, expect, it } from "vitest";
import { Tariff } from "./tariff.ts";

const grid = (value = 0) => Array.from({ length: 12 }, () => Array<number>(24).fill(value));

const tariff = {
  schedule: "B-10",
  source: "urdb",
  sourceId: "abc123",
  effectiveStart: "2026-03-01",
  updatedAt: "2026-03-15",
  energyWeekdaySchedule: grid(1),
  energyWeekendSchedule: grid(0),
  energyPeriods: [
    { name: "off-peak", tiers: [{ upToKwh: null, usdPerKwh: 0.24512 }] },
    {
      name: "peak",
      tiers: [
        { upToKwh: 500, usdPerKwh: 0.3 },
        { upToKwh: null, usdPerKwh: 0.35 },
      ],
    },
  ],
  demandWeekdaySchedule: grid(0),
  demandWeekendSchedule: grid(0),
  demandPeriods: [{ name: "peak", tiers: [{ upToKw: null, usdPerKw: 12.5 }] }],
  flatDemandMonths: Array<number>(12).fill(0),
  flatDemandPeriods: [{ name: "max", tiers: [{ upToKw: null, usdPerKw: 3.25 }] }],
  fixedCharges: [{ name: "Customer charge", usd: 4.92, per: "day" }],
};

describe("Tariff", () => {
  it("accepts a full tariff", () => {
    expect(Tariff.parse(tariff)).toEqual(tariff);
  });

  it("accepts a tariff with no demand charges", () => {
    expect(
      Tariff.safeParse({
        ...tariff,
        demandWeekdaySchedule: null,
        demandWeekendSchedule: null,
        demandPeriods: [],
        flatDemandMonths: null,
        flatDemandPeriods: [],
      }).success,
    ).toBe(true);
  });

  it("rejects a grid of the wrong shape", () => {
    expect(Tariff.safeParse({ ...tariff, energyWeekdaySchedule: grid().slice(1) }).success).toBe(false);
    const shortDay = grid();
    shortDay[3] = Array<number>(23).fill(0);
    expect(Tariff.safeParse({ ...tariff, energyWeekendSchedule: shortDay }).success).toBe(false);
  });

  it("rejects an index pointing at a missing period", () => {
    expect(Tariff.safeParse({ ...tariff, energyWeekdaySchedule: grid(2) }).success).toBe(false);
    expect(Tariff.safeParse({ ...tariff, demandWeekendSchedule: grid(1) }).success).toBe(false);
    expect(Tariff.safeParse({ ...tariff, flatDemandMonths: Array<number>(12).fill(1) }).success).toBe(
      false,
    );
  });

  it("rejects a demand schedule set for only part of the week", () => {
    expect(Tariff.safeParse({ ...tariff, demandWeekendSchedule: null }).success).toBe(false);
  });

  it("rejects a last tier with an upper limit", () => {
    const energyPeriods = [{ name: "flat", tiers: [{ upToKwh: 500, usdPerKwh: 0.3 }] }];
    expect(
      Tariff.safeParse({
        ...tariff,
        energyPeriods,
        energyWeekdaySchedule: grid(),
        energyWeekendSchedule: grid(),
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown source or schedule", () => {
    expect(Tariff.safeParse({ ...tariff, source: "guess" }).success).toBe(false);
    expect(Tariff.safeParse({ ...tariff, schedule: "E-19" }).success).toBe(false);
  });
});
