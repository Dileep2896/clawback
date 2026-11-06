import type { Tariff } from "@bill-fighter/shared/tariff";

// ts is the start of a 15 minute interval.
export type Interval = { ts: string | Date; kwh: number };
// ISO dates, both inclusive, as on a bill.
export type BillingPeriod = { start: string; end: string };

export type PricedBill = {
  energyCents: number;
  demandCents: number;
  fixedCents: number;
  totalCents: number;
  maxKw: number;
  energy: {
    period: string;
    kwh: number;
    cents: number;
    tiers: { kwh: number; usdPerKwh: number; cents: number }[];
  }[];
  demand: {
    period: string;
    kind: "tou" | "flat";
    maxKw: number;
    // Billing days this charge covers. Fewer than the whole bill when it spans a season change.
    days: number;
    cents: number;
    tiers: { kw: number; usdPerKw: number; cents: number }[];
  }[];
  fixed: { name: string; cents: number }[];
};

const INTERVALS_PER_HOUR = 4;
const MS_PER_DAY = 86_400_000;

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  weekday: "short",
});

function pacificTime(instant: Date) {
  const parts = Object.fromEntries(PACIFIC.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    month: Number(parts.month) - 1,
    hour: Number(parts.hour),
    weekend: parts.weekday === "Sat" || parts.weekday === "Sun",
  };
}

// The one rounding rule: dollars to integer cents, half away from zero, applied once per charge line.
// Snapping first makes float noise (1.005 * 100 = 100.49999...) round the way it does by hand.
export function roundCents(usd: number): number {
  return Math.sign(usd) * Math.round(Number((Math.abs(usd) * 100).toFixed(6))) + 0;
}

// Tier limits are cumulative: each tier prices the quantity between the last limit and its own.
function priceTiers(quantity: number, tiers: { upTo: number | null; rate: number }[], share = 1) {
  const priced: { quantity: number; rate: number; cents: number }[] = [];
  let below = 0;
  for (const { upTo, rate } of tiers) {
    const inTier = Math.min(quantity, upTo ?? Infinity) - below;
    if (inTier <= 0) break;
    priced.push({ quantity: inTier, rate, cents: roundCents(inTier * rate * share) });
    below += inTier;
  }
  return priced;
}

const sumCents = (lines: { cents: number }[]) => lines.reduce((sum, line) => sum + line.cents, 0);

const keepMax = (maxes: Map<number, number>, index: number, kw: number) =>
  maxes.set(index, Math.max(maxes.get(index) ?? 0, kw));

export function priceUsage(intervals: Interval[], tariff: Tariff, period: BillingPeriod): PricedBill {
  const startMs = Date.parse(period.start);
  const endMs = Date.parse(period.end);
  const days = (endMs - startMs) / MS_PER_DAY + 1;
  if (!(days >= 1)) throw new Error(`Bad billing period: ${period.start} to ${period.end}`);

  // Keyed by period index, because URDB can repeat a period name across seasons.
  const kwhByPeriod = new Map<number, number>();
  const touMaxKw = new Map<number, number>();
  const flatMaxKw = new Map<number, number>();
  let maxKw = 0;

  for (const { ts, kwh } of intervals) {
    const instant = new Date(ts);
    // Formatting is slow and callers may pass a whole year per bill, so drop far-off intervals first.
    // These bounds are safely wider than the Pacific day; an unreadable ts passes through and throws below.
    if (instant.getTime() < startMs || instant.getTime() > endMs + 2 * MS_PER_DAY) continue;
    const { date, month, hour, weekend } = pacificTime(instant);
    if (date < period.start || date > period.end) continue;

    // No holiday calendar: all four PG&E sheets apply TOU periods every day, including holidays.
    const energyGrid = weekend ? tariff.energyWeekendSchedule : tariff.energyWeekdaySchedule;
    const energyIndex = energyGrid[month]![hour]!;
    kwhByPeriod.set(energyIndex, (kwhByPeriod.get(energyIndex) ?? 0) + kwh);

    const kw = kwh * INTERVALS_PER_HOUR;
    maxKw = Math.max(maxKw, kw);
    const demandGrid = weekend ? tariff.demandWeekendSchedule : tariff.demandWeekdaySchedule;
    if (demandGrid) keepMax(touMaxKw, demandGrid[month]![hour]!, kw);
    if (tariff.flatDemandMonths) keepMax(flatMaxKw, tariff.flatDemandMonths[month]!, kw);
  }

  const energy = tariff.energyPeriods.flatMap(({ name, tiers }, index) => {
    const kwh = kwhByPeriod.get(index);
    if (kwh === undefined) return [];
    const priced = priceTiers(
      kwh,
      tiers.map((t) => ({ upTo: t.upToKwh, rate: t.usdPerKwh })),
    );
    return [
      {
        period: name,
        kwh,
        cents: sumCents(priced),
        tiers: priced.map((t) => ({ kwh: t.quantity, usdPerKwh: t.rate, cents: t.cents })),
      },
    ];
  });

  // PG&E prorates a bill spanning June 1 or October 1 by days in each season. Seasons are the months
  // a demand period's grid uses it, so a year-round period covers every day and stays at full charge.
  const billMonths = Array.from({ length: days }, (_, i) => new Date(startMs + i * MS_PER_DAY).getUTCMonth());
  const priceDemand = (
    periods: Tariff["demandPeriods"],
    maxes: Map<number, number>,
    kind: "tou" | "flat",
    usedInMonth: (index: number, month: number) => boolean,
  ): PricedBill["demand"] =>
    periods.flatMap(({ name, tiers }, index) => {
      const kw = maxes.get(index);
      if (kw === undefined) return [];
      const coveredDays = billMonths.filter((month) => usedInMonth(index, month)).length;
      const priced = priceTiers(
        kw,
        tiers.map((t) => ({ upTo: t.upToKw, rate: t.usdPerKw })),
        coveredDays / days,
      );
      return [
        {
          period: name,
          kind,
          maxKw: kw,
          days: coveredDays,
          cents: sumCents(priced),
          tiers: priced.map((t) => ({ kw: t.quantity, usdPerKw: t.rate, cents: t.cents })),
        },
      ];
    });
  const demand = [
    ...priceDemand(
      tariff.demandPeriods,
      touMaxKw,
      "tou",
      (index, month) =>
        !!tariff.demandWeekdaySchedule?.[month]?.includes(index) ||
        !!tariff.demandWeekendSchedule?.[month]?.includes(index),
    ),
    ...priceDemand(
      tariff.flatDemandPeriods,
      flatMaxKw,
      "flat",
      (index, month) => tariff.flatDemandMonths?.[month] === index,
    ),
  ];

  const fixed = tariff.fixedCharges.map(({ name, usd, per }) => ({
    name,
    cents: roundCents(per === "day" ? usd * days : usd),
  }));

  const energyCents = sumCents(energy);
  const demandCents = sumCents(demand);
  const fixedCents = sumCents(fixed);
  return {
    energyCents,
    demandCents,
    fixedCents,
    totalCents: energyCents + demandCents + fixedCents,
    maxKw,
    energy,
    demand,
    fixed,
  };
}
