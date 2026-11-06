import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tariff, RateSchedule } from "@bill-fighter/shared/tariff";
import { compareTariffs, loadTariff } from "./load.ts";
import { normalizeUrdb, URDB_RECORDS } from "./normalize.ts";

const NOW = new Date("2026-11-06T00:00:00Z");
const DATA = new URL("../../../../data/tariffs/", import.meta.url);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const warnings = () => warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");

describe("loadTariff on the committed data", () => {
  it.each(RateSchedule.options)("%s returns a valid tariff with no network", (schedule) => {
    const fetchStub = vi.fn(() => {
      throw new Error("no network");
    });
    vi.stubGlobal("fetch", fetchStub);
    expect(Tariff.safeParse(loadTariff(schedule, { now: NOW })).success).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("uses URDB where it bills like the sheet and fallback where it does not", () => {
    const sources = RateSchedule.options.map((schedule) => [schedule, loadTariff(schedule, { now: NOW }).source]);
    expect(sources).toEqual([
      ["B-1", "fallback"],
      ["B-6", "urdb"],
      ["B-10", "fallback"],
      ["B-19", "fallback"],
    ]);
  });

  it("logs the known URDB errors", () => {
    loadTariff("B-10", { now: NOW });
    expect(warnings()).toContain("energy weekday Oct hours 16,17,18,19,20: $0.22773 vs $0.26321");
    expect(warnings()).toContain("flat demand periods group differently");
    loadTariff("B-1", { now: NOW });
    expect(warnings()).toContain("energy weekend Jan hours 9,10,11,12,13: $0.36291 vs $0.37933");
  });

  it("does not warn about age for records under 12 months old", () => {
    loadTariff("B-6", { now: NOW });
    expect(warnings()).not.toContain("older than 12 months");
  });

  it("warns once a record passes 12 months", () => {
    loadTariff("B-6", { now: new Date("2027-03-28T00:00:00Z") });
    expect(warnings()).toContain("start date 2026-03-27 is older than 12 months");
    expect(warnings()).toContain("start date 2026-03-01 is older than 12 months");
  });
});

describe("loadTariff when the cache is unusable", () => {
  let dir: string;
  const url = () => new URL(`${pathToFileURL(dir).href}/`);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tariffs-"));
    cpSync(new URL("fallback/", DATA), join(dir, "fallback"), { recursive: true });
    cpSync(new URL("urdb/", DATA), join(dir, "urdb"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("falls back when the cached file is missing", () => {
    rmSync(join(dir, "urdb/B-6.json"));
    expect(loadTariff("B-6", { now: NOW, dir: url() }).source).toBe("fallback");
    expect(warnings()).toContain("no usable URDB cache");
  });

  it("falls back when the cached file is corrupt", () => {
    writeFileSync(join(dir, "urdb/B-6.json"), "{ not json");
    expect(loadTariff("B-6", { now: NOW, dir: url() }).source).toBe("fallback");
  });

  it("throws when the fallback itself is invalid", () => {
    writeFileSync(join(dir, "fallback/B-6.json"), "{}");
    expect(() => loadTariff("B-6", { now: NOW, dir: url() })).toThrow();
  });
});

describe("compareTariffs", () => {
  const read = (schedule: RateSchedule) => loadTariff(schedule, { now: NOW });

  it("finds no difference between a tariff and itself", () => {
    const tariff = read("B-19");
    expect(compareTariffs(tariff, tariff)).toEqual([]);
  });

  it("ignores period numbering when the bills are the same", () => {
    const a = read("B-6");
    const reversed = [...a.energyPeriods].reverse();
    const flip = (grid: number[][]) => grid.map((r) => r.map((i) => a.energyPeriods.length - 1 - i));
    const b = {
      ...a,
      energyPeriods: reversed,
      energyWeekdaySchedule: flip(a.energyWeekdaySchedule),
      energyWeekendSchedule: flip(a.energyWeekendSchedule),
    };
    expect(compareTariffs(a, b)).toEqual([]);
  });

  it("treats a zero-rate demand period as no demand charge", () => {
    const a = read("B-6");
    const grid = Array.from({ length: 12 }, () => Array<number>(24).fill(0));
    const b = {
      ...a,
      demandWeekdaySchedule: grid,
      demandWeekendSchedule: grid,
      demandPeriods: [{ name: "Off-Peak", tiers: [{ upToKw: null, usdPerKw: 0 }] }],
    };
    expect(compareTariffs(a, b)).toEqual([]);
  });

  it("catches changed rates, fixed charges and demand season months", () => {
    const a = read("B-19");
    const energyPeriods = a.energyPeriods.map((p, i) =>
      i === 0 ? { ...p, tiers: [{ upToKwh: null, usdPerKwh: 0.99 }] } : p,
    );
    expect(compareTariffs(a, { ...a, energyPeriods }).join()).toContain("$0.06442 vs $0.99");
    expect(compareTariffs(a, { ...a, fixedCharges: [{ name: "x", usd: 1, per: "day" }] })).toEqual([
      "fixed charges: $11.36882/day vs $1/day",
    ]);
    const urdb = normalizeUrdb(
      JSON.parse(readFileSync(new URL("urdb/B-19.json", DATA), "utf8")),
      "B-19",
      URDB_RECORDS["B-19"].periods,
    );
    expect(compareTariffs(urdb, a)).toEqual([
      "flat demand periods group differently: [0,0,0,0,1,1,1,1,1,1,0,0] vs [0,0,0,0,0,1,1,1,1,0,0,0]",
    ]);
  });
});
