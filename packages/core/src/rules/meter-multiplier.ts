import type { BillFixture } from "@bill-fighter/shared/fixtures";
import { Finding } from "@bill-fighter/shared/finding";
import { RateSchedule, type Tariff } from "@bill-fighter/shared/tariff";
import { priceUsage, type Interval } from "../tariff/price-usage.ts";
import { billsOf, dollars, type AuditInput } from "./input.ts";

const CLAIM_MONTHS = 36;
const SAVINGS_MONTHS = 12;
const NEAR = 0.01;

const threeDecimals = (value: number) => Number(value.toFixed(3));
const isNear = (ratio: number, whole: number) => Math.abs(ratio - whole) <= whole * NEAR;

function monthsBefore(date: string, months: number) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() - months);
  return day.toISOString().slice(0, 10);
}

// shortcut: a gap of exactly half a bill's intervals would look like a doubled bill, so check interval counts if real meter feeds are ever loaded.
function compare(bill: BillFixture, intervals: Interval[], tariff: Tariff) {
  const metered = priceUsage(intervals, tariff, {
    start: bill.periodStart,
    end: bill.periodEnd,
  });
  const billedKwh = bill.kwhByTouPeriod.reduce((sum, p) => sum + p.kwh, 0);
  const intervalKwh = metered.energy.reduce((sum, e) => sum + e.kwh, 0);
  return {
    bill,
    billedKwh,
    intervalKwh,
    // Always kWh: the bill total is below the multiple because fixed charges are not multiplied.
    ratio: billedKwh / intervalKwh,
    correctCents: metered.totalCents,
    overbilledCents: Math.max(0, bill.totalCents - metered.totalCents),
  };
}

export function meterMultiplierJump(input: AuditInput): Finding[] {
  const findings: Finding[] = [];

  for (const account of input.accounts.filter((a) => a.serviceType === "electric")) {
    const bills = billsOf(input, account.id);
    const intervals = input.intervals[account.id];
    if (!intervals || bills.length === 0) continue;

    // A bill with no usable schedule or no intervals to compare proves nothing, so it never joins a run.
    const rows = bills
      .flatMap((b) => {
        const schedule = RateSchedule.safeParse(b.rateSchedule);
        return schedule.success ? [compare(b, intervals, input.tariffFor(schedule.data))] : [];
      })
      .filter((r) => r.intervalKwh > 0);
    const anchor = bills.at(-1)!.periodEnd;
    const claimFrom = monthsBefore(anchor, CLAIM_MONTHS);
    const savingsFrom = monthsBefore(anchor, SAVINGS_MONTHS);

    for (let i = 1; i < rows.length; i++) {
      const before = rows[i - 1]!;
      const jump = rows[i]!;
      const multiple = Math.round(jump.ratio);
      const meterChanged =
        before.bill.meterNumber !== null && jump.bill.meterNumber !== null && before.bill.meterNumber !== jump.bill.meterNumber;
      if (!meterChanged || !isNear(before.ratio, 1) || multiple < 2 || !isNear(jump.ratio, multiple)) continue;

      let end = i;
      while (rows[end + 1] && isNear(rows[end + 1]!.ratio, multiple)) end++;
      const run = rows.slice(i, end + 1);
      const stillBilling = end === rows.length - 1;
      i = end;

      const claimable = run.filter((r) => r.bill.periodStart >= claimFrom);
      if (claimable.length === 0) continue;
      const refundCents = claimable.reduce((sum, r) => sum + r.overbilledCents, 0);
      const annualSavingsCents = stillBilling
        ? run.filter((r) => r.bill.periodStart >= savingsFrom).reduce((sum, r) => sum + r.overbilledCents, 0)
        : 0;
      const swapMonth = jump.bill.periodStart.slice(0, 7);

      findings.push(
        Finding.parse({
          customerId: input.customerId,
          accountId: account.id,
          type: "meterMultiplierJump",
          title: `Billed ${multiple}x metered usage since the ${swapMonth} meter change`,
          explanation:
            `After meter ${before.bill.meterNumber} was replaced by ${jump.bill.meterNumber} in ${swapMonth}, billed kWh is ${multiple} times the interval data on ${run.length} bills. ` +
            `Refund to claim under the 3 year window of Electric Rule 17.1: ${dollars(refundCents)} across ${claimable.length} bills. ` +
            (stillBilling
              ? `Correcting the multiplier saves about ${dollars(annualSavingsCents)} a year. `
              : "Later bills are correct again, so there is no ongoing saving. ") +
            "The refund is a claim until the provider credits it.",
          evidence: {
            billIds: claimable.map((r) => r.bill.id),
            billLineIds: claimable.flatMap((r) => r.bill.lines.filter((l) => l.lineType === "energy").map((l) => l.id)),
            phoneLineIds: [],
            detail: {
              swapMonth,
              oldMeter: before.bill.meterNumber,
              newMeter: jump.bill.meterNumber,
              oldMultiplier: before.bill.multiplier,
              newMultiplier: jump.bill.multiplier,
              kwhRatio: multiple,
              claimWindowStart: claimFrom,
              // Includes the bills before the swap, which are the baseline.
              bills: rows.slice(0, end + 1).map((r) => ({
                billId: r.bill.id,
                periodStart: r.bill.periodStart,
                billedKwh: threeDecimals(r.billedKwh),
                intervalKwh: threeDecimals(r.intervalKwh),
                kwhRatio: threeDecimals(r.ratio),
                billedCents: r.bill.totalCents,
                correctCents: r.correctCents,
                overbilledCents: run.includes(r) ? r.overbilledCents : 0,
              })),
            },
          },
          refundCents,
          annualSavingsCents,
          confidence: 0.95,
        }),
      );
    }
  }
  return findings;
}
