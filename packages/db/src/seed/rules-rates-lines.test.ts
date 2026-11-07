import type { AuditInput } from "@bill-fighter/core/rules/input";
import { compareRates, rateOptimization } from "@bill-fighter/core/rules/rate-optimization";
import { unusedLines } from "@bill-fighter/core/rules/unused-lines";
import { loadTariff } from "@bill-fighter/core/tariff/load";
import { priceUsage } from "@bill-fighter/core/tariff/price-usage";
import type { RateSchedule, Tariff } from "@bill-fighter/shared/tariff";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_MONTH, LAST_MONTH } from "./customer.ts";
import { calendarMonth, generateSeed, monthsBetween, type Seed } from "./generate.ts";

const SLOW = 180_000;
const FREMONT = "fremont-1-electric";
const OAKLAND = ["oakland-1-electric", "oakland-2-electric"];
const YEAR = monthsBetween(FIRST_MONTH, LAST_MONTH);

let seed: Seed;
let input: AuditInput;

const percentCheaper = (fromCents: number, toCents: number) => (1 - toCents / fromCents) * 100;

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  seed = generateSeed();
  const tariffs = new Map<RateSchedule, Tariff>();
  input = {
    customerId: seed.customer.id,
    accounts: seed.accounts,
    bills: seed.bills,
    phoneLines: seed.phoneLines,
    intervals: seed.intervals,
    tariffFor(schedule) {
      const tariff = tariffs.get(schedule) ?? loadTariff(schedule);
      tariffs.set(schedule, tariff);
      return tariff;
    },
  };
}, SLOW);

describe("rateOptimization over the seed", () => {
  const months = (findings: ReturnType<typeof rateOptimization>) =>
    findings.flatMap((f) => (f.evidence.detail.months as { savingsPct: number }[]).map((m) => m.savingsPct));

  it("proposes B-6 for Oakland #1 and #2 only, about 3.75% cheaper, as the calculator computes it", () => {
    const findings = rateOptimization(input);
    expect(findings.map((f) => f.accountId)).toEqual(OAKLAND);

    for (const finding of findings) {
      expect(finding.title).toContain("Rule 12");
      expect(finding.evidence.detail).toMatchObject({ currentSchedule: "B-10", proposedSchedule: "B-6" });
      expect(finding.evidence.billIds).toEqual(YEAR.map((month) => `${finding.accountId}-${month}`));
      expect(finding.refundCents).toBe(0);

      const intervals = seed.intervals[finding.accountId]!;
      const annual = (schedule: RateSchedule) => YEAR.reduce((sum, month) => sum + priceUsage(intervals, loadTariff(schedule), calendarMonth(month)).totalCents, 0);
      const current = annual("B-10");
      expect(finding.annualSavingsCents).toBe(current - annual("B-6"));

      const saved = percentCheaper(current, annual("B-6"));
      expect(saved).toBeGreaterThan(3.7);
      expect(saved).toBeLessThan(3.8);
    }
  }, SLOW);

  it("shows single months from 5.1% dearer to 10.4% cheaper across the two stores", () => {
    const savings = months(rateOptimization(input));
    expect(savings).toHaveLength(24);
    expect(Math.min(...savings)).toBeCloseTo(-5.1, 1);
    expect(Math.max(...savings)).toBeCloseTo(10.4, 1);
    for (const finding of rateOptimization(input)) expect(finding.explanation).toMatch(/\d+ of 12 months cost more on B-6/);
  }, SLOW);

  it("only finds Fremont's 17.21% B-19 saving on the doubled usage it was billed for", () => {
    const b19 = (from: AuditInput) => {
      const comparison = compareRates(from, FREMONT)!;
      expect(comparison.current.schedule).toBe("B-6");
      return { comparison, pct: percentCheaper(comparison.current.annualCents, comparison.alternatives.find((a) => a.schedule === "B-19")!.annualCents) };
    };

    // True usage: B-19 is dearer, and no finding of any kind comes out.
    const real = b19(input);
    expect(real.pct).toBeCloseTo(-0.51, 2);
    expect(rateOptimization(input).filter((f) => f.accountId === FREMONT)).toEqual([]);

    const doubledUsage: AuditInput = {
      ...input,
      intervals: { ...input.intervals, [FREMONT]: input.intervals[FREMONT]!.map(({ ts, kwh }) => ({ ts, kwh: kwh * 2 })) },
    };
    const doubled = b19(doubledUsage);
    expect(doubled.pct).toBeCloseTo(17.21, 2);

    // That usage really is what the bills charged for, so reading them would have proposed this.
    const billedCents = doubled.comparison.bills.reduce((sum, b) => sum + b.totalCents, 0);
    expect(doubled.comparison.current.annualCents).toBe(billedCents);
    const [falseFinding] = rateOptimization(doubledUsage).filter((f) => f.accountId === FREMONT);
    expect(falseFinding!.evidence.detail).toMatchObject({ proposedSchedule: "B-19" });
  }, SLOW);
});

describe("unusedLines over the seed", () => {
  const UNUSED = [
    "fremont-2-telecom-pots-1",
    "oakland-3-telecom-pots-1",
    "san-jose-2-telecom-pots-1",
    "san-jose-3-telecom-pots-1",
    "sf-1-telecom-pots-1",
    "sf-3-telecom-pots-1",
    "sf-3-telecom-pots-2",
  ];
  const ALARMS = ["san-jose-2-telecom-pots-2", "sf-1-telecom-pots-2"];
  const lineIds = (findings: ReturnType<typeof unusedLines>) => findings.flatMap((f) => f.evidence.phoneLineIds).sort();

  it("finds seven unused lines worth $5,040 a year", () => {
    const unused = unusedLines(input).filter((f) => f.annualSavingsCents > 0);
    expect(lineIds(unused)).toEqual(UNUSED);
    expect(unused.reduce((sum, f) => sum + f.annualSavingsCents, 0)).toBe(504_000);
    for (const finding of unused) {
      expect(finding.annualSavingsCents).toBe(72_000);
      expect(finding.evidence.detail).toMatchObject({ action: "cancel" });
      expect(finding.evidence.billIds).toEqual([`${finding.accountId}-${LAST_MONTH}`]);
      expect(finding.evidence.billLineIds).toHaveLength(1);
    }
  });

  it("asks to confirm the two alarm lines, at $0 with no cancel action", () => {
    const alarms = unusedLines(input).filter((f) => f.annualSavingsCents === 0);
    expect(lineIds(alarms)).toEqual(ALARMS);
    for (const finding of alarms) {
      expect(finding.title).toMatch(/confirm with alarm company/i);
      expect(finding.evidence.detail).toMatchObject({ action: "confirmWithAlarmCompany" });
      expect(`${finding.title} ${finding.explanation} ${JSON.stringify(finding.evidence.detail)}`).not.toMatch(/cancel|save|switch/i);
    }
  });

  it("leaves every voice line alone", () => {
    expect(unusedLines(input)).toHaveLength(9);
    for (const finding of unusedLines(input)) expect(finding.evidence.phoneLineIds[0]).toContain("-pots-");
  });
});
