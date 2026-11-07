import { Finding } from "@bill-fighter/shared/finding";
import { RateSchedule } from "@bill-fighter/shared/tariff";
import { eligibleSchedules, sustainedKw } from "../tariff/eligibility.ts";
import { priceUsage, type PricedBill } from "../tariff/price-usage.ts";
import { billsOf, dollars, followsOn, latestPeriodEnd, type AuditInput } from "./input.ts";

const YEAR_OF_BILLS = 12;
const MIN_SAVINGS_PERCENT = 2;

const percentSaved = (fromCents: number, toCents: number) => Number((((fromCents - toCents) / fromCents) * 100).toFixed(2));

// Prices come from intervals alone: billed kWh, totals and max kW can be wrong, as Fremont's doubled bills are, and
// comparing against them would invent savings.
// shortcut: a month with only some of its intervals is priced as if complete, so check interval counts if real meter feeds are ever loaded.
export function compareRates(input: AuditInput, accountId: string) {
  const bills = billsOf(input, accountId).slice(-YEAR_OF_BILLS);
  const intervals = input.intervals[accountId];
  // A year's claim needs a full, unbroken year up to the current bill.
  if (!intervals || bills.length < YEAR_OF_BILLS || bills.at(-1)!.periodEnd !== latestPeriodEnd(input, accountId)) return null;
  if (!bills.every((bill, i) => i === 0 || followsOn(bills[i - 1]!, bill))) return null;
  // A change inside the window may have spent Rule 12's one change per 12 months.
  const schedule = RateSchedule.safeParse(bills[0]!.rateSchedule);
  if (!schedule.success || bills.some((b) => b.rateSchedule !== schedule.data)) return null;

  const price = (priced: RateSchedule) => {
    const tariff = input.tariffFor(priced);
    const months: PricedBill[] = bills.map((b) => priceUsage(intervals, tariff, { start: b.periodStart, end: b.periodEnd }));
    return { schedule: priced, months, annualCents: months.reduce((sum, m) => sum + m.totalCents, 0) };
  };
  const current = price(schedule.data);
  if (current.months.some((m) => m.energy.every((e) => e.kwh === 0))) return null;

  const monthlyMaxKw = current.months.map((m) => m.maxKw);
  const heldKw = sustainedKw(monthlyMaxKw);
  const alternatives = eligibleSchedules(heldKw)
    .filter((s) => s !== schedule.data)
    .map(price);
  return { bills, current, alternatives, peakKw: Math.max(...monthlyMaxKw), heldKw };
}

export function rateOptimization(input: AuditInput): Finding[] {
  return input.accounts
    .filter((account) => account.serviceType === "electric")
    .flatMap((account) => {
      const comparison = compareRates(input, account.id);
      if (!comparison) return [];
      const { bills, current, alternatives, peakKw, heldKw } = comparison;
      const best = alternatives.reduce<(typeof alternatives)[number] | null>(
        (cheapest, option) => (!cheapest || option.annualCents < cheapest.annualCents ? option : cheapest),
        null,
      );
      if (!best) return [];
      const annualSavingsCents = current.annualCents - best.annualCents;
      // Whole numbers, so exactly 2% cannot pass on float noise.
      if (annualSavingsCents * 100 <= current.annualCents * MIN_SAVINGS_PERCENT) return [];

      const months = bills.map((bill, i) => ({
        billId: bill.id,
        periodStart: bill.periodStart,
        currentCents: current.months[i]!.totalCents,
        proposedCents: best.months[i]!.totalCents,
        savingsPct: percentSaved(current.months[i]!.totalCents, best.months[i]!.totalCents),
      }));
      const dearerMonths = months.filter((m) => m.proposedCents > m.currentCents).length;

      return [
        Finding.parse({
          customerId: input.customerId,
          accountId: account.id,
          type: "rateOptimization",
          title: `Rule 12 change from ${current.schedule} to ${best.schedule} saves ${dollars(annualSavingsCents)} a year`,
          explanation:
            `Re-pricing the last ${bills.length} months of metered usage, ${best.schedule} costs ${dollars(best.annualCents)} against ${dollars(current.annualCents)} on ${current.schedule}, ` +
            `${percentSaved(current.annualCents, best.annualCents)}% less. ` +
            (dearerMonths > 0 ? `This is a yearly figure: ${dearerMonths} of ${bills.length} months cost more on ${best.schedule}. ` : "") +
            "Request the change under Rule 12, which allows one change per 12 months.",
          evidence: {
            billIds: bills.map((b) => b.id),
            billLineIds: [],
            phoneLineIds: [],
            detail: {
              currentSchedule: current.schedule,
              proposedSchedule: best.schedule,
              windowStart: bills[0]!.periodStart,
              windowEnd: bills.at(-1)!.periodEnd,
              peakKw,
              heldKw,
              schedules: [current, ...alternatives].map((option) => ({
                schedule: option.schedule,
                annualCents: option.annualCents,
                savingsPct: percentSaved(current.annualCents, option.annualCents),
              })),
              months,
            },
          },
          refundCents: 0,
          annualSavingsCents,
          // Not higher: the calculator leaves out Peak Day Pricing and other charges, see data/tariffs/README.md.
          confidence: 0.85,
        }),
      ];
    });
}
