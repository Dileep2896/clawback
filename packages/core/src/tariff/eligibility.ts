import type { RateSchedule } from "@bill-fighter/shared/tariff";

// Limits are whole kW, so "B-19 mandatory above 499" and "B-10 under 500" are the same line.
// B-20 is mandatory from 1000 kW and is not a modelled schedule, so nothing is offered there.
const UNDER_KW: readonly (readonly [RateSchedule, number])[] = [
  ["B-1", 75],
  ["B-6", 75],
  ["B-10", 500],
  ["B-19", 1000],
];

// shortcut: takes a single 12 month max, so a "for N consecutive months" limit cannot be expressed,
// upgrade to monthly maxes if the current tariff sheets turn out to require it.
export function eligibleSchedules(maxKw: number): RateSchedule[] {
  return UNDER_KW.filter(([, limit]) => maxKw < limit).map(([schedule]) => schedule);
}
