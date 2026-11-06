import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeUrdb, pickCurrentRecord, URDB_RECORDS } from "./normalize.ts";

const saved = JSON.parse(readFileSync(new URL("./__fixtures__/urdb-b19.json", import.meta.url), "utf8"));
const b19 = URDB_RECORDS["B-19"].periods;
const row = (digits: string) => [...digits].map(Number);

const WINTER = row("111111111111111122222111");
const SPRING = row("111111111000001122222111");
const SUMMER = row("333333333333334455555443");
const DEMAND_WINTER = row("000000000000000011111000");
const DEMAND_SUMMER = row("000000000000002233333220");

const simple = {
  label: "abc",
  name: "Test",
  startdate: 1774598400,
  revisions: [1774598500, 1776172678],
  energyratestructure: [
    [
      { rate: 0.1, adj: 0.2, max: 500, unit: "kWh" },
      { rate: 0.5, unit: "kWh" },
    ],
  ],
  energyweekdayschedule: Array.from({ length: 12 }, () => Array<number>(24).fill(0)),
  energyweekendschedule: Array.from({ length: 12 }, () => Array<number>(24).fill(0)),
  fixedchargefirstmeter: 30,
  fixedchargeunits: "$/month",
};
const simpleNames = { energy: ["All"], demand: [], flatDemand: [] };

describe("normalizeUrdb", () => {
  it("normalizes a saved URDB record", () => {
    const tariff = normalizeUrdb(saved, "B-19", b19);

    expect(tariff).toMatchObject({
      schedule: "B-19",
      source: "urdb",
      sourceId: "69de8cdb02f684104e01267d",
      effectiveStart: "2026-03-27",
      updatedAt: "2026-04-14",
      fixedCharges: [{ name: "Customer Charge", usd: 11.36882, per: "day" }],
    });
    const energyGrid = [WINTER, WINTER, SPRING, SPRING, SPRING, SUMMER, SUMMER, SUMMER, SUMMER, WINTER, WINTER, WINTER];
    expect(tariff.energyWeekdaySchedule).toEqual(energyGrid);
    expect(tariff.energyWeekendSchedule).toEqual(energyGrid);
    expect(tariff.energyPeriods.map((p) => [p.name, p.tiers])).toEqual([
      ["Super Off-Peak Winter", [{ upToKwh: null, usdPerKwh: 0.06442 }]],
      ["Off-Peak Winter", [{ upToKwh: null, usdPerKwh: 0.12026 }]],
      ["Peak Winter", [{ upToKwh: null, usdPerKwh: 0.16188 }]],
      ["Off-Peak Summer", [{ upToKwh: null, usdPerKwh: 0.12037 }]],
      ["Part-Peak Summer", [{ upToKwh: null, usdPerKwh: 0.14775 }]],
      ["Peak Summer", [{ upToKwh: null, usdPerKwh: 0.18648 }]],
    ]);
    const demandGrid = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => (m >= 5 && m <= 8 ? DEMAND_SUMMER : DEMAND_WINTER));
    expect(tariff.demandWeekdaySchedule).toEqual(demandGrid);
    expect(tariff.demandWeekendSchedule).toEqual(demandGrid);
    expect(tariff.demandPeriods.map((p) => p.tiers[0]!.usdPerKw)).toEqual([0, 2.31, 10.52, 46.16]);
    expect(tariff.flatDemandMonths).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0]);
    expect(tariff.flatDemandPeriods.map((p) => p.tiers[0]!.usdPerKw)).toEqual([37.37, 37.37]);
  });

  it("maps tiers, adds adj, opens the last tier and uses the latest revision", () => {
    const tariff = normalizeUrdb(simple, "B-1", simpleNames);
    expect(tariff.energyPeriods[0]!.tiers).toEqual([
      { upToKwh: 500, usdPerKwh: 0.3 },
      { upToKwh: null, usdPerKwh: 0.5 },
    ]);
    expect(tariff.updatedAt).toBe("2026-04-14");
    expect(tariff.fixedCharges).toEqual([{ name: "Customer Charge", usd: 30, per: "month" }]);
  });

  it("maps demand tiers", () => {
    const tariff = normalizeUrdb(
      {
        ...simple,
        flatdemandstructure: [[{ rate: 5, max: 100 }, { rate: 7, max: 9999 }]],
        flatdemandmonths: Array<number>(12).fill(0),
        flatdemandunit: "kW",
      },
      "B-1",
      { ...simpleNames, flatDemand: ["Max"] },
    );
    expect(tariff.flatDemandPeriods[0]!.tiers).toEqual([
      { upToKw: 100, usdPerKw: 5 },
      { upToKw: null, usdPerKw: 7 },
    ]);
  });

  it.each([
    ["an energy unit other than kWh", { energyratestructure: [[{ rate: 1, unit: "kWh/day" }]] }, /only kWh/],
    ["a fixed charge per year", { fixedchargeunits: "$/year" }, /fixed charge/],
    ["a minimum charge", { mincharge: 10 }, /minimum charge/],
    [
      "demand in kVA",
      { flatdemandstructure: [[{ rate: 5 }]], flatdemandmonths: Array<number>(12).fill(0), flatdemandunit: "kVA" },
      /only kW/,
    ],
  ])("rejects %s rather than misprice it", (_name, change, message) => {
    expect(() => normalizeUrdb({ ...simple, ...change }, "B-1", { ...simpleNames, flatDemand: ["Max"] })).toThrow(message);
  });

  it("rejects a record whose period count does not match the names", () => {
    expect(() => normalizeUrdb(simple, "B-1", { ...simpleNames, energy: ["A", "B"] })).toThrow(/energy periods/);
  });
});

describe("pickCurrentRecord", () => {
  const current = { name: "B-6", label: "new" };
  const ended = { name: "B-6", label: "old", enddate: 1774000000 };

  it("ignores ended records and other names", () => {
    expect(pickCurrentRecord([ended, current, { name: "B-1" }], "B-6")).toBe(current);
  });

  it("fails on none or several", () => {
    expect(() => pickCurrentRecord([ended], "B-6")).toThrow(/found 0/);
    expect(() => pickCurrentRecord([current, current], "B-6")).toThrow(/found 2/);
  });
});
