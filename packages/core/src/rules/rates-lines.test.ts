import type { BillFixture, PhoneLineFixture } from "@bill-fighter/shared/fixtures";
import { Tariff, type RateSchedule } from "@bill-fighter/shared/tariff";
import { describe, expect, it } from "vitest";
import type { AuditInput } from "./input.ts";
import { compareRates, rateOptimization } from "./rate-optimization.ts";
import { unusedLines } from "./unused-lines.ts";

const grid = () => Array.from({ length: 12 }, () => Array<number>(24).fill(0));

const tariff = (schedule: RateSchedule, usdPerKwh: number) =>
  Tariff.parse({
    schedule,
    source: "fallback",
    sourceId: "test",
    effectiveStart: "2026-01-01",
    updatedAt: "2026-01-01",
    energyWeekdaySchedule: grid(),
    energyWeekendSchedule: grid(),
    energyPeriods: [{ name: "flat", tiers: [{ upToKwh: null, usdPerKwh }] }],
    demandWeekdaySchedule: null,
    demandWeekendSchedule: null,
    demandPeriods: [],
    flatDemandMonths: null,
    flatDemandPeriods: [],
    fixedCharges: [],
  });

const ACCOUNT = "a-electric";
const MONTHLY_KWH = 1000;
const MS_15_MIN = 900_000;
const monthStart = (i: number) => new Date(Date.UTC(2023, i, 1)).toISOString().slice(0, 10);
const monthEnd = (i: number) => new Date(Date.UTC(2023, i + 1, 0)).toISOString().slice(0, 10);

function bill(i: number, overrides: Partial<BillFixture> = {}): BillFixture {
  const id = `${ACCOUNT}-${i}`;
  return {
    id,
    accountId: ACCOUNT,
    periodStart: monthStart(i),
    periodEnd: monthEnd(i),
    totalCents: 10_000,
    pdfPath: null,
    meterNumber: "M",
    multiplier: 1,
    rateSchedule: "B-10",
    planCode: null,
    kwhByTouPeriod: [{ period: "flat", kwh: MONTHLY_KWH }],
    maxKw: 40,
    lines: [{ id: `${id}-1`, description: "flat energy", quantity: MONTHLY_KWH, unit: "kWh", rate: 0.1, amountCents: 10_000, lineType: "energy" }],
    ...overrides,
  };
}

// The same kWh every month, drawn at the given kW, so demand moves without moving the price.
const usage = (kwByMonth: number[]) =>
  kwByMonth.flatMap((kw, i) =>
    Array.from({ length: (MONTHLY_KWH * 4) / kw }, (_, n) => ({
      ts: new Date(Date.UTC(2023, i, 15) + n * MS_15_MIN).toISOString(),
      kwh: kw / 4,
    })),
  );

const year = () => Array.from({ length: 12 }, (_, i) => bill(i));
const flat = (months: number) => Array<number>(months).fill(40);

const PRICES: Record<RateSchedule, number> = { "B-1": 0.2, "B-6": 0.09, "B-10": 0.1, "B-19": 0.2 };

const electric = { id: ACCOUNT, locationId: "s", provider: "utility", accountNumber: "1", serviceType: "electric" as const, rateSchedule: "B-10", meterNumber: "M" };

const input = (bills: BillFixture[], overrides: Partial<AuditInput> & { prices?: Partial<Record<RateSchedule, number>> } = {}): AuditInput => {
  const { prices, ...rest } = overrides;
  return {
    customerId: "c",
    accounts: [electric],
    bills,
    phoneLines: [],
    intervals: { [ACCOUNT]: usage(flat(bills.length)) },
    tariffFor: (schedule) => tariff(schedule, { ...PRICES, ...prices }[schedule]),
    ...rest,
  };
};

describe("rateOptimization", () => {
  it("proposes the cheapest eligible schedule with a month by month comparison", () => {
    const [finding, ...others] = rateOptimization(input(year()));
    expect(others).toEqual([]);
    expect(finding).toMatchObject({ accountId: ACCOUNT, type: "rateOptimization", refundCents: 0, annualSavingsCents: 12_000 });
    expect(finding!.title).toContain("Rule 12");
    expect(finding!.evidence.billIds).toEqual(year().map((b) => b.id));
    expect(finding!.evidence.detail).toMatchObject({ currentSchedule: "B-10", proposedSchedule: "B-6" });
    const months = finding!.evidence.detail.months as { billId: string; currentCents: number; proposedCents: number; savingsPct: number }[];
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ billId: `${ACCOUNT}-0`, currentCents: 10_000, proposedCents: 9_000, savingsPct: 10 });
  });

  it("makes no proposal at exactly 2%, and does just over it", () => {
    expect(rateOptimization(input(year(), { prices: { "B-6": 0.098 } }))).toEqual([]);
    expect(rateOptimization(input(year(), { prices: { "B-6": 0.0979 } }))[0]!.annualSavingsCents).toBe(2_520);
  });

  it("makes no proposal when the current schedule is already cheapest", () => {
    expect(rateOptimization(input(year(), { prices: { "B-6": 0.11 } }))).toEqual([]);
  });

  describe("eligibility", () => {
    const prices = { "B-1": 0.05, "B-6": 0.05, "B-19": 0.09 };
    const withKw = (kw: number[]) => input(year(), { prices, intervals: { [ACCOUNT]: usage(kw) } });
    const proposed = (kw: number[]) => rateOptimization(withKw(kw))[0]?.evidence.detail.proposedSchedule;
    const high = (...months: number[]) => flat(12).map((kw, i) => (months.includes(i) ? 80 : kw));

    it("never proposes a cheaper schedule the account does not qualify for", () => {
      expect(proposed(high(3, 4, 5))).toBe("B-19");
    });

    it("still offers it after a lone spike or non-consecutive high months", () => {
      expect(proposed(high(4))).toBe("B-1");
      expect(proposed(high(1, 3, 5, 7))).toBe("B-1");
    });

    it("judges eligibility on metered kW, not the kW a bill claims", () => {
      const claims500 = year().map((b) => ({ ...b, maxKw: 500 }));
      expect(rateOptimization(input(claims500, { prices }))[0]?.evidence.detail.proposedSchedule).toBe("B-1");
    });
  });

  it("ignores billed kWh and totals, so a doubled bill invents nothing", () => {
    const doubled = year().map((b) => ({ ...b, totalCents: 20_000, multiplier: 2, kwhByTouPeriod: [{ period: "flat", kwh: MONTHLY_KWH * 2 }], maxKw: 80 }));
    expect(rateOptimization(input(doubled))[0]!.annualSavingsCents).toBe(12_000);
    expect(rateOptimization(input(doubled, { prices: { "B-6": 0.11 } }))).toEqual([]);
  });

  it("uses only the latest 12 bills", () => {
    const bills = Array.from({ length: 14 }, (_, i) => bill(i));
    const [finding] = rateOptimization(input(bills));
    expect(finding!.evidence.billIds).toEqual(bills.slice(2).map((b) => b.id));
    expect(finding!.annualSavingsCents).toBe(12_000);
  });

  it.each<[string, () => AuditInput]>([
    ["fewer than 12 bills", () => input(year().slice(1))],
    ["a gap in the bills", () => input(Array.from({ length: 13 }, (_, i) => bill(i)).filter((_, i) => i !== 5))],
    ["a schedule change inside the window", () => input(year().map((b, i) => (i === 6 ? { ...b, rateSchedule: "B-6" } : b)))],
    ["a schedule we cannot price", () => input(year().map((b) => ({ ...b, rateSchedule: "E-19" })))],
    ["no intervals", () => input(year(), { intervals: {} })],
    ["a month with no intervals", () => input(year(), { intervals: { [ACCOUNT]: usage(flat(11)) } })],
    ["a newer reissue that cannot be trusted", () => input([...year(), bill(12), { ...bill(12), id: "reissue" }])],
  ])("makes no claim on %s", (_, build) => {
    expect(rateOptimization(build())).toEqual([]);
  });

  it("leaves accounts that are not electric alone", () => {
    expect(rateOptimization(input(year(), { accounts: [{ ...electric, serviceType: "gas" }] }))).toEqual([]);
  });

  it("exposes the comparison even when nothing is proposed", () => {
    const comparison = compareRates(input(year(), { prices: { "B-6": 0.11 } }), ACCOUNT)!;
    expect(comparison.current).toMatchObject({ schedule: "B-10", annualCents: 120_000 });
    expect(comparison.alternatives.map((a) => a.schedule)).toEqual(["B-1", "B-6", "B-19"]);
    expect(comparison).toMatchObject({ peakKw: 40, heldKw: 40 });
  });
});

describe("unusedLines", () => {
  const TELECOM = "a-telecom";
  const phone = (overrides: Partial<PhoneLineFixture>): PhoneLineFixture => ({
    id: "line",
    accountId: TELECOM,
    number: "(415) 555-0102",
    label: "Back office fax",
    monthlyCents: 6_000,
    callsLast12mo: 0,
    purpose: "fax",
    ...overrides,
  });
  const telecomBill = (i: number, numbers: string[]): BillFixture => ({
    ...bill(i),
    id: `${TELECOM}-${i}`,
    accountId: TELECOM,
    rateSchedule: null,
    lines: numbers.map((number, n) => ({ id: `${TELECOM}-${i}-${n}`, description: `Copper line ${number}`, quantity: 1, unit: "line", rate: 60, amountCents: 6_000, lineType: "pots" })),
  });
  const lines = (phoneLines: PhoneLineFixture[], bills = [telecomBill(0, ["(415) 555-0102"]), telecomBill(1, ["(415) 555-0102"])]) =>
    unusedLines(input(bills, { phoneLines, accounts: [] }));

  it("claims a year of a zero call line, pointing at the line and its latest bill line", () => {
    const [finding, ...others] = lines([phone({})]);
    expect(others).toEqual([]);
    expect(finding).toMatchObject({ accountId: TELECOM, type: "unusedLines", annualSavingsCents: 72_000, refundCents: 0 });
    expect(finding!.evidence).toMatchObject({ phoneLineIds: ["line"], billIds: [`${TELECOM}-1`], billLineIds: [`${TELECOM}-1-0`] });
    expect(finding!.evidence.detail).toMatchObject({ action: "cancel" });
  });

  it.each([
    ["with calls", 4],
    ["with no calls", 0],
  ])("only asks to confirm an alarm line %s, at $0 with no cancel action", (_, callsLast12mo) => {
    const [finding] = lines([phone({ purpose: "alarm", label: "Alarm panel", callsLast12mo })]);
    expect(finding!.title).toMatch(/confirm with alarm company/i);
    expect(finding!.annualSavingsCents).toBe(0);
    expect(finding!.evidence.detail).toMatchObject({ action: "confirmWithAlarmCompany" });
    expect(`${finding!.title} ${finding!.explanation} ${JSON.stringify(finding!.evidence.detail)}`).not.toMatch(/cancel|save|switch/i);
  });

  it("ignores a line with calls", () => {
    expect(lines([phone({ purpose: "voice", label: "Main line", callsLast12mo: 2000 })])).toEqual([]);
    expect(lines([phone({ callsLast12mo: 1 })])).toEqual([]);
  });

  it("gives each line its own finding, even on one account", () => {
    const other = "(415) 555-0103";
    const found = lines([phone({}), phone({ id: "other", number: other })], [telecomBill(0, ["(415) 555-0102", other])]);
    expect(found.map((f) => f.evidence.phoneLineIds)).toEqual([["line"], ["other"]]);
  });

  it("claims nothing for a line gone from the latest bill, or when a reissue hides the latest bill", () => {
    expect(lines([phone({})], [telecomBill(0, ["(415) 555-0102"]), telecomBill(1, [])])).toEqual([]);
    const number = ["(415) 555-0102"];
    expect(lines([phone({})], [telecomBill(0, number), telecomBill(1, number), { ...telecomBill(1, number), id: "reissue" }])).toEqual([]);
  });
});
