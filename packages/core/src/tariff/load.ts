import { readFileSync } from "node:fs";
import { Tariff, type RateSchedule } from "@bill-fighter/shared/tariff";
import { normalizeUrdb, URDB_RECORDS } from "./normalize.ts";

const DATA_DIR = new URL("../../../../data/tariffs/", import.meta.url);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Tier = { limit: number | null; rate: number };

const priceLabel = (tiers: Tier[] | undefined) =>
  !tiers || tiers.every((t) => t.rate === 0)
    ? "no charge"
    : tiers.map((t) => `$${t.rate}${t.limit === null ? "" : ` up to ${t.limit}`}`).join(", ");

const energyTiers = (tariff: Tariff) =>
  tariff.energyPeriods.map((p) => p.tiers.map((t) => ({ limit: t.upToKwh, rate: t.usdPerKwh })));
const demandTiers = (periods: Tariff["demandPeriods"]) =>
  periods.map((p) => p.tiers.map((t) => ({ limit: t.upToKw, rate: t.usdPerKw })));

function compareGrid(
  name: string,
  [gridA, tiersA]: [number[][] | null, Tier[][]],
  [gridB, tiersB]: [number[][] | null, Tier[][]],
): string[] {
  const hoursByDifference = new Map<string, number[]>();
  for (let month = 0; month < 12; month++) {
    for (let hour = 0; hour < 24; hour++) {
      const a = priceLabel(tiersA[gridA?.[month]?.[hour] ?? -1]);
      const b = priceLabel(tiersB[gridB?.[month]?.[hour] ?? -1]);
      if (a === b) continue;
      const key = `${name} ${MONTHS[month]} hours %: ${a} vs ${b}`;
      hoursByDifference.set(key, [...(hoursByDifference.get(key) ?? []), hour]);
    }
  }
  return [...hoursByDifference].map(([key, hours]) => key.replace("%", hours.join(",")));
}

// Numbers each period by first appearance, so two lists match when they split cells into the same groups.
function grouping(cells: number[]) {
  const seen = new Map<number, number>();
  return cells.map((cell) => seen.get(cell) ?? seen.set(cell, seen.size).get(cell)!).join();
}

// The calculator keeps one max kW per demand period, so equal prices grouped differently still bill differently.
function compareGrouping(name: string, a: number[] | null, b: number[] | null): string[] {
  return grouping(a ?? Array<number>(b?.length ?? 0).fill(-1)) === grouping(b ?? Array<number>(a?.length ?? 0).fill(-1))
    ? []
    : [`${name} periods group differently: [${a}] vs [${b}]`];
}

// Weekdays and weekends together, because one period can span both and share a max kW or a tier count.
const demandCells = (t: Tariff) =>
  t.demandWeekdaySchedule && [...t.demandWeekdaySchedule.flat(), ...t.demandWeekendSchedule!.flat()];
// Untiered periods are all -1: usage only accumulates towards a threshold, so their grouping cannot change a bill.
const tieredEnergyCells = (t: Tariff) =>
  [...t.energyWeekdaySchedule.flat(), ...t.energyWeekendSchedule.flat()].map((cell) =>
    t.energyPeriods[cell]!.tiers.length > 1 ? cell : -1,
  );

const fixedLabel = (tariff: Tariff) =>
  tariff.fixedCharges
    .map((c) => `$${c.usd}/${c.per}`)
    .sort()
    .join(", ");

// Compares what would be billed, not how each tariff numbers its periods. Empty means they agree.
export function compareTariffs(a: Tariff, b: Tariff): string[] {
  const differences = [
    ...compareGrid("energy weekday", [a.energyWeekdaySchedule, energyTiers(a)], [b.energyWeekdaySchedule, energyTiers(b)]),
    ...compareGrid("energy weekend", [a.energyWeekendSchedule, energyTiers(a)], [b.energyWeekendSchedule, energyTiers(b)]),
    ...compareGrid(
      "demand weekday",
      [a.demandWeekdaySchedule, demandTiers(a.demandPeriods)],
      [b.demandWeekdaySchedule, demandTiers(b.demandPeriods)],
    ),
    ...compareGrid(
      "demand weekend",
      [a.demandWeekendSchedule, demandTiers(a.demandPeriods)],
      [b.demandWeekendSchedule, demandTiers(b.demandPeriods)],
    ),
    ...compareGrouping("energy", tieredEnergyCells(a), tieredEnergyCells(b)),
    ...compareGrouping("demand", demandCells(a), demandCells(b)),
    ...compareGrouping("flat demand", a.flatDemandMonths, b.flatDemandMonths),
  ];
  const flatA = demandTiers(a.flatDemandPeriods);
  const flatB = demandTiers(b.flatDemandPeriods);
  for (let month = 0; month < 12; month++) {
    const priceA = priceLabel(flatA[a.flatDemandMonths?.[month] ?? -1]);
    const priceB = priceLabel(flatB[b.flatDemandMonths?.[month] ?? -1]);
    if (priceA !== priceB) differences.push(`flat demand ${MONTHS[month]}: ${priceA} vs ${priceB}`);
  }
  if (fixedLabel(a) !== fixedLabel(b)) differences.push(`fixed charges: ${fixedLabel(a)} vs ${fixedLabel(b)}`);
  return differences;
}

export function logTariffDates(tariff: Tariff, now = new Date()) {
  const label = `${tariff.schedule} ${tariff.source} ${tariff.sourceId}`;
  console.info(`${label}: starts ${tariff.effectiveStart}, updated ${tariff.updatedAt}`);
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  if (new Date(tariff.effectiveStart) < cutoff) {
    console.warn(`${label}: start date ${tariff.effectiveStart} is older than 12 months, check for newer rates`);
  }
}

// Reads local files only, so it works offline. URDB wins only when it bills exactly like the
// hand-checked fallback, because URDB's TOU grids have been wrong against PG&E's own sheets.
export function loadTariff(schedule: RateSchedule, { now = new Date(), dir = DATA_DIR } = {}): Tariff {
  const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, dir), "utf8"));
  const fallback = Tariff.parse(read(`fallback/${schedule}.json`));
  logTariffDates(fallback, now);

  let cached: Tariff;
  try {
    cached = normalizeUrdb(read(`urdb/${schedule}.json`), schedule, URDB_RECORDS[schedule].periods);
  } catch (error) {
    console.warn(`${schedule}: no usable URDB cache, using fallback. ${(error as Error).message}`);
    return fallback;
  }
  logTariffDates(cached, now);

  const differences = compareTariffs(cached, fallback);
  if (differences.length === 0) return cached;
  console.warn(`${schedule}: URDB disagrees with the PG&E sheet (urdb vs fallback), using fallback:\n  ${differences.join("\n  ")}`);
  return fallback;
}
