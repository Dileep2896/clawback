import { loadTariff } from "@bill-fighter/core/tariff/load";
import { arithmeticCheck } from "@bill-fighter/core/rules/arithmetic-check";
import type { AuditInput } from "@bill-fighter/core/rules/input";
import { meterMultiplierJump } from "@bill-fighter/core/rules/meter-multiplier";
import { promoExpiry } from "@bill-fighter/core/rules/promo-expiry";
import { thirdPartySupplier } from "@bill-fighter/core/rules/third-party-supplier";
import type { RateSchedule, Tariff } from "@bill-fighter/shared/tariff";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LAST_MONTH, METER_SWAP } from "./customer.ts";
import { generateSeed, monthsBetween, type Seed } from "./generate.ts";

const SLOW = 180_000;
const FREMONT = `${METER_SWAP.storeId}-electric`;
const PROMO_ACCOUNTS = ["fremont-2-internet", "san-jose-1-internet", "sf-2-internet"];
const DECOY = "oakland-3-gas";

const RULES = [meterMultiplierJump, promoExpiry, arithmeticCheck, thirdPartySupplier];

let seed: Seed;
let input: AuditInput;

const within1Percent = (cents: number, target: number) => expect(Math.abs(cents - target)).toBeLessThanOrEqual(target * 0.01);

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

describe("billing rules over the seed", () => {
  it("finds Fremont #1 near $12,600 refund and $10,800 a year, from exact bills and lines", () => {
    const findings = meterMultiplierJump(input);
    expect(findings.map((f) => f.accountId)).toEqual([FREMONT]);
    const [finding] = findings;
    within1Percent(finding!.refundCents, 1_260_000);
    within1Percent(finding!.annualSavingsCents, 1_080_000);

    const billIds = monthsBetween(METER_SWAP.swapMonth, LAST_MONTH).map((month) => `${FREMONT}-${month}`);
    expect(billIds).toHaveLength(14);
    expect(finding!.evidence.billIds).toEqual(billIds);
    const claimed = seed.bills.filter((b) => billIds.includes(b.id));
    const energyLineIds = claimed.flatMap((b) => b.lines.filter((l) => l.lineType === "energy").map((l) => l.id));
    expect(energyLineIds.length).toBeGreaterThanOrEqual(14);
    expect([...finding!.evidence.billLineIds].sort()).toEqual([...energyLineIds].sort());
    expect(finding!.evidence.detail).toMatchObject({ swapMonth: METER_SWAP.swapMonth, oldMeter: METER_SWAP.oldMeter, kwhRatio: 2 });
  }, SLOW);

  it("finds three promos totalling $3,240 a year", () => {
    const findings = promoExpiry(input);
    expect(findings.map((f) => f.accountId).sort()).toEqual(PROMO_ACCOUNTS);
    expect(findings.reduce((sum, f) => sum + f.annualSavingsCents, 0)).toBe(324_000);
    for (const finding of findings) expect(finding.refundCents).toBe(0);
  });

  it("flags the Oakland #3 decoy to review the contract, at $0 with no switch advice", () => {
    const findings = thirdPartySupplier(input);
    expect(findings.map((f) => f.accountId)).toEqual([DECOY]);
    const [finding] = findings;
    expect(finding!.title).toMatch(/review contract, check exit fees/i);
    expect(finding!.refundCents).toBe(0);
    expect(finding!.annualSavingsCents).toBe(0);
    expect(`${finding!.title} ${finding!.explanation}`).not.toMatch(/switch|cancel|cheaper|save/i);
  });

  it("finds no bill whose lines miss its total", () => {
    expect(arithmeticCheck(input)).toEqual([]);
  });

  it("gives zero findings on an unchanged bill set", () => {
    const planted = new Set([FREMONT, ...PROMO_ACCOUNTS, DECOY]);
    const clean: AuditInput = {
      ...input,
      accounts: input.accounts.filter((a) => !planted.has(a.id)),
      bills: input.bills.filter((b) => !planted.has(b.accountId)),
    };
    expect(clean.bills.length).toBeGreaterThan(300);
    expect(RULES.flatMap((rule) => rule(clean))).toEqual([]);
  }, SLOW);
});
