import type { BillFixture } from "@bill-fighter/shared/fixtures";
import { Tariff } from "@bill-fighter/shared/tariff";
import { describe, expect, it } from "vitest";
import { arithmeticCheck } from "./arithmetic-check.ts";
import type { AuditInput } from "./input.ts";
import { meterMultiplierJump } from "./meter-multiplier.ts";
import { promoExpiry } from "./promo-expiry.ts";
import { thirdPartySupplier } from "./third-party-supplier.ts";

const grid = () => Array.from({ length: 12 }, () => Array<number>(24).fill(0));

// $0.10 a kWh and $10 a month, so a true 1,000 kWh month costs $110 and billed at 2x costs $210.
const TARIFF = Tariff.parse({
  schedule: "B-6",
  source: "fallback",
  sourceId: "test",
  effectiveStart: "2026-01-01",
  updatedAt: "2026-01-01",
  energyWeekdaySchedule: grid(),
  energyWeekendSchedule: grid(),
  energyPeriods: [{ name: "flat", tiers: [{ upToKwh: null, usdPerKwh: 0.1 }] }],
  demandWeekdaySchedule: null,
  demandWeekendSchedule: null,
  demandPeriods: [],
  flatDemandMonths: null,
  flatDemandPeriods: [],
  fixedCharges: [{ name: "Customer charge", usd: 10, per: "month" }],
});
const TRUE_KWH = 1000;
const OVERBILLED_AT_2X = 10_000;

const ACCOUNT = "a-electric";
const monthStart = (i: number) => new Date(Date.UTC(2023, i, 1)).toISOString().slice(0, 10);
const monthEnd = (i: number) => new Date(Date.UTC(2023, i + 1, 0)).toISOString().slice(0, 10);

function bill(i: number, overrides: Partial<BillFixture> = {}): BillFixture {
  const id = `${ACCOUNT}-${i}`;
  return {
    id,
    accountId: ACCOUNT,
    periodStart: monthStart(i),
    periodEnd: monthEnd(i),
    totalCents: 11_000,
    pdfPath: null,
    meterNumber: "OLD",
    multiplier: 1,
    rateSchedule: "B-6",
    planCode: null,
    kwhByTouPeriod: [{ period: "flat", kwh: TRUE_KWH }],
    maxKw: null,
    lines: [
      { id: `${id}-1`, description: "flat energy", quantity: TRUE_KWH, unit: "kWh", rate: 0.1, amountCents: 10_000, lineType: "energy" },
      { id: `${id}-2`, description: "Customer charge", quantity: null, unit: null, rate: null, amountCents: 1_000, lineType: "fixed" },
    ],
    ...overrides,
  };
}

function billedAt(i: number, multiple: number, meterNumber: string): BillFixture {
  const billed = bill(i, {
    meterNumber,
    multiplier: multiple,
    totalCents: TRUE_KWH * multiple * 10 + 1_000,
    kwhByTouPeriod: [{ period: "flat", kwh: TRUE_KWH * multiple }],
  });
  billed.lines[0] = { ...billed.lines[0]!, quantity: TRUE_KWH * multiple, amountCents: TRUE_KWH * multiple * 10 };
  return billed;
}

const intervalsFor = (months: number) =>
  Array.from({ length: months }, (_, i) => ({ ts: `${monthStart(i).slice(0, 7)}-15T20:00:00Z`, kwh: TRUE_KWH }));

const electric = { id: ACCOUNT, locationId: "s", provider: "utility", accountNumber: "1", serviceType: "electric" as const, rateSchedule: "B-6", meterNumber: "NEW" };

const input = (bills: BillFixture[], overrides: Partial<AuditInput> = {}): AuditInput => ({
  customerId: "c",
  accounts: [electric],
  bills,
  phoneLines: [],
  intervals: { [ACCOUNT]: intervalsFor(bills.length) },
  tariffFor: () => TARIFF,
  ...overrides,
});

// Two good months on the old meter, then `after` months at the multiple on the new one.
const swapped = (after: number, multiple = 2) => [
  bill(0),
  bill(1),
  ...Array.from({ length: after }, (_, i) => billedAt(i + 2, multiple, "NEW")),
];

describe("meterMultiplierJump", () => {
  it("claims the overbill by hand on 14 bills, with exact evidence", () => {
    const bills = swapped(14);
    const [finding, ...rest] = meterMultiplierJump(input(bills));
    expect(rest).toEqual([]);
    expect(finding!.refundCents).toBe(14 * OVERBILLED_AT_2X);
    expect(finding!.annualSavingsCents).toBe(12 * OVERBILLED_AT_2X);
    expect(finding!.evidence.billIds).toEqual(bills.slice(2).map((b) => b.id));
    expect(finding!.evidence.billLineIds).toEqual(bills.slice(2).map((b) => `${b.id}-1`));
    expect(finding!.evidence.detail).toMatchObject({ oldMeter: "OLD", newMeter: "NEW", oldMultiplier: 1, newMultiplier: 2, kwhRatio: 2 });
    expect(finding!.evidence.detail.bills).toHaveLength(16);
  });

  it("calls the refund a claim, never recovered money", () => {
    const [finding] = meterMultiplierJump(input(swapped(14)));
    expect(finding!.explanation).toMatch(/claim/i);
    expect(finding!.explanation).not.toMatch(/recovered|refunded|credited to/i);
  });

  it("caps the refund at 36 months, counted from the latest bill", () => {
    const bills = swapped(40);
    const [finding] = meterMultiplierJump(input(bills));
    expect(finding!.refundCents).toBe(36 * OVERBILLED_AT_2X);
    expect(finding!.evidence.billIds).toEqual(bills.slice(-36).map((b) => b.id));
    expect(finding!.annualSavingsCents).toBe(12 * OVERBILLED_AT_2X);
  });

  it("gives no finding when the only overbilled months are older than the cap", () => {
    const bills = [...swapped(2), ...Array.from({ length: 40 }, (_, i) => bill(i + 4, { meterNumber: "NEW" }))];
    expect(meterMultiplierJump(input(bills))).toEqual([]);
  });

  it("ignores dollars: a doubled total with flat kWh on a new meter is no finding", () => {
    const bills = [bill(0), bill(1), bill(2, { meterNumber: "NEW", totalCents: 22_000 })];
    expect(meterMultiplierJump(input(bills))).toEqual([]);
  });

  it("needs a meter change: doubled kWh on the same meter is no finding", () => {
    expect(meterMultiplierJump(input([bill(0), billedAt(1, 2, "OLD"), billedAt(2, 2, "OLD")]))).toEqual([]);
  });

  it("needs a near whole multiple: 1.5x is no finding", () => {
    expect(meterMultiplierJump(input(swapped(3, 1.5)))).toEqual([]);
  });

  it("needs a clean baseline: already doubled before the meter change is no finding", () => {
    expect(meterMultiplierJump(input([billedAt(0, 2, "OLD"), billedAt(1, 2, "NEW")]))).toEqual([]);
  });

  it("works when the bill shows no multiplier, because detection reads kWh", () => {
    const bills = swapped(3).map((b) => ({ ...b, multiplier: null }));
    expect(meterMultiplierJump(input(bills))).toHaveLength(1);
  });

  it("gives no savings once later bills are correct again, but keeps the refund", () => {
    const bills = [...swapped(3), bill(5, { meterNumber: "NEW" }), bill(6, { meterNumber: "NEW" })];
    const [finding] = meterMultiplierJump(input(bills));
    expect(finding!.refundCents).toBe(3 * OVERBILLED_AT_2X);
    expect(finding!.annualSavingsCents).toBe(0);
  });

  it("gives no finding for an account with no intervals", () => {
    expect(meterMultiplierJump(input(swapped(3), { intervals: {} }))).toEqual([]);
  });

  it("leaves a bill with no intervals out of the claim", () => {
    const bills = swapped(3);
    const intervals = intervalsFor(bills.length).filter((_, i) => i !== 3);
    const [finding] = meterMultiplierJump(input(bills, { intervals: { [ACCOUNT]: intervals } }));
    expect(finding!.refundCents).toBe(2 * OVERBILLED_AT_2X);
    expect(finding!.annualSavingsCents).toBe(2 * OVERBILLED_AT_2X);
    expect(finding!.evidence.billIds).not.toContain(bills[3]!.id);
  });

  it.each([null, "E-19"])("leaves a bill with schedule %s out of the claim", (rateSchedule) => {
    const bills = swapped(3);
    bills[3] = { ...bills[3]!, rateSchedule };
    const [finding] = meterMultiplierJump(input(bills));
    expect(finding!.refundCents).toBe(2 * OVERBILLED_AT_2X);
    expect(finding!.annualSavingsCents).toBe(2 * OVERBILLED_AT_2X);
    expect(finding!.evidence.billIds).not.toContain(bills[3]!.id);
  });

  describe("only compares truly consecutive bills", () => {
    it("invents no meter change across a skipped bill on the new meter", () => {
      const bills = [bill(0), bill(1, { meterNumber: "NEW", rateSchedule: null }), billedAt(2, 2, "NEW")];
      expect(meterMultiplierJump(input(bills))).toEqual([]);
    });

    it("invents no meter change across a bill with no intervals", () => {
      const bills = [bill(0), bill(1, { meterNumber: "NEW" }), billedAt(2, 2, "NEW")];
      const intervals = intervalsFor(3).filter((_, i) => i !== 1);
      expect(meterMultiplierJump(input(bills, { intervals: { [ACCOUNT]: intervals } }))).toEqual([]);
    });

    it("needs a checked baseline right before the jump, even when the meter visibly changed", () => {
      const bills = [bill(0), bill(1, { rateSchedule: null }), billedAt(2, 2, "NEW")];
      expect(meterMultiplierJump(input(bills))).toEqual([]);
    });

    it("invents no meter change across a month with no bill at all", () => {
      const bills = [bill(0), billedAt(2, 2, "NEW"), billedAt(3, 2, "NEW")];
      expect(meterMultiplierJump(input(bills, { intervals: { [ACCOUNT]: intervalsFor(4) } }))).toEqual([]);
    });
  });

  describe("claims no ongoing savings the latest bill cannot back", () => {
    it("keeps the refund when the latest bill has no usable schedule", () => {
      const [finding] = meterMultiplierJump(input([...swapped(1), bill(3, { meterNumber: "NEW", rateSchedule: null })]));
      expect(finding!.refundCents).toBe(OVERBILLED_AT_2X);
      expect(finding!.annualSavingsCents).toBe(0);
      expect(finding!.explanation).toMatch(/does not confirm/);
      expect(finding!.explanation).not.toMatch(/correct again/);
    });

    it("keeps the refund when the latest bill has no intervals", () => {
      const bills = [...swapped(1), billedAt(3, 2, "NEW")];
      const [finding] = meterMultiplierJump(input(bills, { intervals: { [ACCOUNT]: intervalsFor(3) } }));
      expect(finding!.refundCents).toBe(OVERBILLED_AT_2X);
      expect(finding!.annualSavingsCents).toBe(0);
    });

    it("does not call a latest bill at another multiple correct", () => {
      const [finding] = meterMultiplierJump(input([...swapped(2), billedAt(4, 1.5, "NEW")]));
      expect(finding!.annualSavingsCents).toBe(0);
      expect(finding!.explanation).not.toMatch(/correct again/);
    });

    it("stops the run at a further meter, which the swap does not explain", () => {
      const [finding] = meterMultiplierJump(input([...swapped(2), billedAt(4, 2, "THIRD")]));
      expect(finding!.refundCents).toBe(2 * OVERBILLED_AT_2X);
      expect(finding!.annualSavingsCents).toBe(0);
    });

    it("claims a reissued bill for the same period once", () => {
      const bills = swapped(2);
      const [finding] = meterMultiplierJump(input([...bills, { ...bills.at(-1)!, id: "reissued" }]));
      expect(finding!.refundCents).toBe(2 * OVERBILLED_AT_2X);
      expect(finding!.evidence.billIds).not.toContain("reissued");
      expect(finding!.annualSavingsCents).toBe(0);
    });
  });

  describe("date windows ending on a leap day", () => {
    const dated = (periodStart: string, periodEnd: string, multiple: number, meterNumber: string) => ({
      ...billedAt(0, multiple, meterNumber),
      id: periodStart,
      periodStart,
      periodEnd,
    });
    // One bill either side of the window's first day, the latest ending 2024-02-29.
    const edges = (year: number) => [
      dated(`${year}-01-27`, `${year}-02-26`, 1, "OLD"),
      dated(`${year}-02-27`, `${year}-02-27`, 2, "NEW"),
      dated(`${year}-02-28`, `${year}-03-31`, 2, "NEW"),
      dated("2024-02-01", "2024-02-29", 2, "NEW"),
    ];
    const run = (bills: BillFixture[]) =>
      meterMultiplierJump(
        input(bills, { intervals: { [ACCOUNT]: bills.map((b) => ({ ts: `${b.periodStart}T20:00:00Z`, kwh: TRUE_KWH })) } }),
      );

    it("counts 36 months back to Feb 28, keeping that bill and dropping the day before", () => {
      const [finding] = run(edges(2021));
      expect(finding!.evidence.billIds).toEqual(["2021-02-28", "2024-02-01"]);
      expect(finding!.evidence.detail.claimWindowStart).toBe("2021-02-28");
    });

    it("counts 12 months back to Feb 28, keeping that bill and dropping the day before", () => {
      const [finding] = run(edges(2023));
      expect(finding!.refundCents).toBe(3 * OVERBILLED_AT_2X);
      expect(finding!.annualSavingsCents).toBe(2 * OVERBILLED_AT_2X);
    });
  });

  it("still audits other accounts when one has no usable schedule or intervals", () => {
    const broken = { ...electric, id: "a-broken", rateSchedule: null };
    const bills = [bill(0, { id: "x", accountId: broken.id, rateSchedule: null }), ...swapped(3)];
    const findings = meterMultiplierJump(
      input(bills, { accounts: [broken, electric], intervals: { [broken.id]: [], [ACCOUNT]: intervalsFor(5) } }),
    );
    expect(findings.map((f) => f.accountId)).toEqual([ACCOUNT]);
  });
});

describe("promoExpiry", () => {
  const flat = (i: number, totalCents: number, overrides: Partial<BillFixture> = {}) =>
    bill(i, {
      planCode: "PLAN",
      totalCents,
      meterNumber: null,
      multiplier: null,
      rateSchedule: null,
      kwhByTouPeriod: [],
      lines: [{ id: `p-${i}`, description: "Internet", quantity: 1, unit: "month", rate: totalCents / 100, amountCents: totalCents, lineType: "internet" }],
      ...overrides,
    });

  it("finds a rise on the same plan with the same usage, as savings and no refund", () => {
    const [finding, ...rest] = promoExpiry(input([flat(0, 9_500), flat(1, 18_500), flat(2, 18_500)]));
    expect(rest).toEqual([]);
    expect(finding!.annualSavingsCents).toBe(108_000);
    expect(finding!.refundCents).toBe(0);
    expect(finding!.evidence.billIds).toEqual([`${ACCOUNT}-0`, `${ACCOUNT}-1`]);
    expect(finding!.evidence.billLineIds).toEqual(["p-0", "p-1"]);
  });

  it("needs more than 30%", () => {
    expect(promoExpiry(input([flat(0, 10_000), flat(1, 13_000)]))).toEqual([]);
    expect(promoExpiry(input([flat(0, 10_000), flat(1, 13_001)]))[0]!.annualSavingsCents).toBe(36_012);
  });

  it("ignores a rise caused by usage, such as more therms", () => {
    const moreUsage = flat(1, 18_500);
    moreUsage.lines[0] = { ...moreUsage.lines[0]!, quantity: 2 };
    expect(promoExpiry(input([flat(0, 9_500), moreUsage]))).toEqual([]);
  });

  it("ignores a rise that comes with a new plan code, or no plan code", () => {
    expect(promoExpiry(input([flat(0, 9_500), flat(1, 18_500, { planCode: "OTHER" })]))).toEqual([]);
    expect(promoExpiry(input([flat(0, 9_500, { planCode: null }), flat(1, 18_500, { planCode: null })]))).toEqual([]);
  });

  it("ignores a rise that has already dropped back", () => {
    expect(promoExpiry(input([flat(0, 9_500), flat(1, 18_500), flat(2, 9_500)]))).toEqual([]);
  });

  it("counts two steps up once, from the first price to the latest", () => {
    const findings = promoExpiry(input([flat(0, 10_000), flat(1, 14_000), flat(2, 20_000)]));
    expect(findings.map((f) => f.annualSavingsCents)).toEqual([120_000]);
  });

  it.each([
    ["an unchanged credit", -1_000, -1_000],
    ["a growing credit", -1_000, -1_100],
    ["a shrinking credit", -1_000, -500],
    ["a credit turning into a charge", -1_000, 500],
    ["a rise from $0", 0, 500],
  ])("ignores %s, which has no positive price to compare", (_, from, to) => {
    expect(promoExpiry(input([flat(0, from), flat(1, to)]))).toEqual([]);
  });

  describe("with several lines", () => {
    const line = (id: string, description: string) =>
      ({ id, description, quantity: 1, unit: "month", rate: null, amountCents: 0, lineType: "internet" }) as const;
    const a = line("a", "Internet");
    const b = line("b", "Static IP");

    it("still finds the rise when the same lines print in another order", () => {
      expect(promoExpiry(input([flat(0, 9_500, { lines: [a, b] }), flat(1, 18_500, { lines: [b, a] })]))).toHaveLength(1);
    });

    it("still finds the rise when the same kWh periods print in another order", () => {
      const peak = { period: "peak", kwh: 10 };
      const offPeak = { period: "off-peak", kwh: 20 };
      const bills = [flat(0, 9_500, { kwhByTouPeriod: [peak, offPeak] }), flat(1, 18_500, { kwhByTouPeriod: [offPeak, peak] })];
      expect(promoExpiry(input(bills))).toHaveLength(1);
    });

    it("counts a repeated line as usage", () => {
      expect(promoExpiry(input([flat(0, 9_500, { lines: [a, a, b] }), flat(1, 18_500, { lines: [a, b, b] })]))).toEqual([]);
      expect(promoExpiry(input([flat(0, 9_500, { lines: [a, b] }), flat(1, 18_500, { lines: [a, a, b] })]))).toEqual([]);
    });
  });
});

describe("arithmeticCheck", () => {
  it("passes a bill whose lines add up", () => {
    expect(arithmeticCheck(input([bill(0)]))).toEqual([]);
  });

  it("flags a one cent miss for review, at $0, with the difference in evidence", () => {
    const [finding] = arithmeticCheck(input([bill(0, { totalCents: 11_001 })]));
    expect(finding!.refundCents).toBe(0);
    expect(finding!.annualSavingsCents).toBe(0);
    expect(finding!.evidence.billIds).toEqual([`${ACCOUNT}-0`]);
    expect(finding!.evidence.billLineIds).toEqual([`${ACCOUNT}-0-1`, `${ACCOUNT}-0-2`]);
    expect(finding!.evidence.detail).toEqual({ linesCents: 11_000, totalCents: 11_001, differenceCents: 1 });
  });
});

describe("thirdPartySupplier", () => {
  const gas = { ...electric, id: "a-gas", serviceType: "gas" as const, rateSchedule: null, meterNumber: null };
  const gasBill = bill(0, { accountId: "a-gas", id: "g-1", planCode: "FIXED" });

  it("flags gas from a provider other than the location's utility, at $0 with no switch advice", () => {
    const [finding] = thirdPartySupplier(input([gasBill], { accounts: [electric, { ...gas, provider: "supplier" }] }));
    expect(finding!.title).toBe("Review contract, check exit fees");
    expect(finding!.refundCents).toBe(0);
    expect(finding!.annualSavingsCents).toBe(0);
    expect(`${finding!.title} ${finding!.explanation}`).not.toMatch(/switch|cancel|cheaper|save/i);
  });

  it("does not flag gas from the location's utility", () => {
    expect(thirdPartySupplier(input([gasBill], { accounts: [electric, gas] }))).toEqual([]);
  });
});
