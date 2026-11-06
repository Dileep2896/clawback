import type { RateSchedule } from "@bill-fighter/shared/tariff";

// Limits are whole kW, so "B-19 mandatory above 499" and "B-10 under 500" are the same line.
// B-20 is mandatory from 1000 kW and is not a modelled schedule, so nothing is offered there.
const UNDER_KW: readonly (readonly [RateSchedule, number])[] = [
  ["B-1", 75],
  ["B-6", 75],
  ["B-10", 500],
  ["B-19", 1000],
];

// shortcut: the PG&E sheets use a 3 consecutive month test, this uses a single 12 month max, which is
// the safe direction (it can under-offer after a lone spike but never offers a schedule the sheet
// refuses), upgrade to monthly maxes if a real account is wrongly held back.
export function eligibleSchedules(maxKw: number): RateSchedule[] {
  return UNDER_KW.filter(([, limit]) => maxKw < limit).map(([schedule]) => schedule);
}
