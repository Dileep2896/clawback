import type { RateSchedule } from "@bill-fighter/shared/tariff";

// Limits are whole kW, so "B-19 mandatory above 499" and "B-10 under 500" are the same line.
// B-20 is mandatory from 1000 kW and is not a modelled schedule, so nothing is offered there.
const UNDER_KW: readonly (readonly [RateSchedule, number])[] = [
  ["B-1", 75],
  ["B-6", 75],
  ["B-10", 500],
  ["B-19", 1000],
];

const HELD_MONTHS = 3;

// The PG&E sheets only count demand held for 3 consecutive months: this is the highest kW reached in every month of
// such a run. Takes consecutive months. Under 3 can't be judged, and NaN offers nothing in eligibleSchedules.
export function sustainedKw(monthlyMaxKw: number[]): number {
  const runs = monthlyMaxKw.slice(HELD_MONTHS - 1).map((_, i) => Math.min(...monthlyMaxKw.slice(i, i + HELD_MONTHS)));
  return runs.length > 0 ? Math.max(...runs) : Number.NaN;
}

export function eligibleSchedules(maxKw: number): RateSchedule[] {
  return UNDER_KW.filter(([, limit]) => maxKw < limit).map(([schedule]) => schedule);
}
