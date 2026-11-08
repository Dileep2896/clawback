import { describe, expect, it } from "vitest";
import { countsInLedger, customerKeepsCents, feeByLine, feeCents, splitFee } from "./fee.ts";

describe("splitFee", () => {
  it("splits the real figures to the cent", () => {
    expect(splitFee({ totalFeeCents: 1_024_961, wonCents: 828_000, sharePct: 30 })).toEqual({ dueNowCents: 248_400, dueWhenGrantedCents: 776_561 });
  });

  it("adds up to the recorded fee when each part alone would round past it", () => {
    // 5 + 5 cents at 30% is a fee of 3, while each 5 alone rounds to 2.
    expect(splitFee({ totalFeeCents: 3, wonCents: 5, sharePct: 30 })).toEqual({ dueNowCents: 2, dueWhenGrantedCents: 1 });
  });

  it("handles nothing won, and everything won", () => {
    expect(splitFee({ totalFeeCents: 300, wonCents: 0, sharePct: 30 })).toEqual({ dueNowCents: 0, dueWhenGrantedCents: 300 });
    expect(splitFee({ totalFeeCents: 300, wonCents: 1_000, sharePct: 30 })).toEqual({ dueNowCents: 300, dueWhenGrantedCents: 0 });
  });

  it("refuses a fee row smaller than what is due now", () => {
    expect(() => splitFee({ totalFeeCents: 100, wonCents: 1_000, sharePct: 30 })).toThrow("out of date");
  });
});

describe("feeCents", () => {
  it.each([
    { refundCents: 1_260_000, annualSavingsCents: 2_000_000, sharePct: 30, fee: 978_000 },
    { refundCents: 1_234_567, annualSavingsCents: 1_999_999, sharePct: 30, fee: 970_370 },
    { refundCents: 100, annualSavingsCents: 0, sharePct: 25, fee: 25 },
    { refundCents: 0, annualSavingsCents: 0, sharePct: 30, fee: 0 },
    { refundCents: 500, annualSavingsCents: 500, sharePct: 0, fee: 0 },
    { refundCents: 500, annualSavingsCents: 500, sharePct: 100, fee: 1000 },
  ])("$sharePct% of $refundCents + $annualSavingsCents is $fee", ({ fee, ...input }) => {
    expect(feeCents(input)).toBe(fee);
  });

  it("rounds half a cent up, once, on the total", () => {
    expect(feeCents({ refundCents: 5, annualSavingsCents: 0, sharePct: 30 })).toBe(2); // 1.5
    expect(feeCents({ refundCents: 25, annualSavingsCents: 0, sharePct: 30 })).toBe(8); // 7.5
    // Rounding each part alone would give 2 + 2.
    expect(feeCents({ refundCents: 5, annualSavingsCents: 5, sharePct: 30 })).toBe(3);
  });

  it.each([-1, 101, 12.5, Number.NaN])("refuses a share of %s", (sharePct) => {
    expect(() => feeCents({ refundCents: 100, annualSavingsCents: 0, sharePct })).toThrow("Invalid savings share");
  });
});

describe("feeByLine", () => {
  it("gives each line its own 30% and the recorded run's lines add up to its fee", () => {
    const linesCents = [1_260_606, 1_071_037, 504_000, 256_895];
    const fees = feeByLine({ linesCents, totalFeeCents: 927_761, sharePct: 30 });
    expect(fees).toEqual([378_182, 321_311, 151_200, 77_068]);
    expect(fees.reduce((sum, fee) => sum + fee, 0)).toBe(927_761);
  });

  it("gives the rounding remainder a cent at a time to the largest dropped fractions", () => {
    // 5 + 5 cents at 30% is a fee of 3, while each 5 alone is 1.5.
    expect(feeByLine({ linesCents: [5, 5], totalFeeCents: 3, sharePct: 30 })).toEqual([2, 1]);
  });

  it("never makes a fee negative", () => {
    // Taking the remainder on the last line gave [2, 2, 2, -1].
    const fees = feeByLine({ linesCents: [5, 5, 5, 1], totalFeeCents: 5, sharePct: 30 });
    expect(fees).toEqual([2, 2, 1, 0]);
    expect(fees.every((fee) => fee >= 0)).toBe(true);
  });

  it("takes a remainder of one cent per line, when every line rounds up", () => {
    expect(feeByLine({ linesCents: [3], totalFeeCents: 1, sharePct: 30 })).toEqual([1]);
    expect(feeByLine({ linesCents: [3, 3], totalFeeCents: 2, sharePct: 30 })).toEqual([1, 1]);
    expect(() => feeByLine({ linesCents: [3, 3], totalFeeCents: 3, sharePct: 30 })).toThrow("out of date");
  });

  it("handles no lines and one line", () => {
    expect(feeByLine({ linesCents: [], totalFeeCents: 0, sharePct: 30 })).toEqual([]);
    expect(() => feeByLine({ linesCents: [], totalFeeCents: 100, sharePct: 30 })).toThrow("out of date");
    expect(feeByLine({ linesCents: [1_000], totalFeeCents: 300, sharePct: 30 })).toEqual([300]);
  });

  it("refuses a total that is more than rounding away from the lines", () => {
    expect(() => feeByLine({ linesCents: [1_000, 1_000], totalFeeCents: 700, sharePct: 30 })).toThrow("out of date");
  });
});

describe("customerKeepsCents", () => {
  it("is the refund plus first year savings, minus the fee", () => {
    expect(customerKeepsCents({ refundCents: 1_260_000, annualSavingsCents: 2_000_000, feeCents: 978_000 })).toBe(2_282_000);
  });
});

describe("countsInLedger", () => {
  const STATUSES = ["proposed", "approved", "filed", "won", "rejected"];

  it.each([
    ["meterMultiplierJump", ["filed", "won"]],
    ["rateOptimization", ["filed", "won"]],
    ["unusedLines", ["won"]],
    ["promoExpiry", ["won"]],
    ["arithmeticCheck", []],
    ["thirdPartySupplier", []],
    ["aRuleNotBuiltYet", []],
    ["constructor", []],
  ])("%s counts only at %j", (type, counted) => {
    expect(STATUSES.filter((status) => countsInLedger({ type, status }))).toEqual(counted);
  });
});
