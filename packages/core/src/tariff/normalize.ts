import { z } from "zod";
import { Tariff, type RateSchedule } from "@bill-fighter/shared/tariff";

const UrdbTier = z.looseObject({
  rate: z.number(),
  adj: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().optional(),
});
const UrdbPeriods = z.array(z.array(UrdbTier));
const UrdbGrid = z.array(z.array(z.number()));

export const UrdbRecord = z.looseObject({
  label: z.string(),
  name: z.string(),
  startdate: z.number(),
  enddate: z.number().optional(),
  revisions: z.array(z.number()).default([]),
  energyratestructure: UrdbPeriods,
  energyweekdayschedule: UrdbGrid,
  energyweekendschedule: UrdbGrid,
  demandratestructure: UrdbPeriods.optional(),
  demandweekdayschedule: UrdbGrid.optional(),
  demandweekendschedule: UrdbGrid.optional(),
  demandrateunit: z.string().optional(),
  flatdemandstructure: UrdbPeriods.optional(),
  flatdemandmonths: z.array(z.number()).optional(),
  flatdemandunit: z.string().optional(),
  fixedchargefirstmeter: z.number().optional(),
  fixedchargeunits: z.string().optional(),
  mincharge: z.number().optional(),
});
export type UrdbRecord = z.infer<typeof UrdbRecord>;

export type PeriodNames = { energy: string[]; demand: string[]; flatDemand: string[] };

const SIX_PERIOD_ENERGY = [
  "Super Off-Peak Winter",
  "Off-Peak Winter",
  "Peak Winter",
  "Off-Peak Summer",
  "Part-Peak Summer",
  "Peak Summer",
];

// The URDB record standing for each schedule, and its period names in URDB order: URDB only has indexes.
// Flat demand names stay plain because URDB's flat index does not follow PG&E's seasons.
export const URDB_RECORDS: Record<RateSchedule, { name: string; periods: PeriodNames }> = {
  "B-1": {
    name: "B-1 Small General Service TOU (Poly-Phase)",
    periods: { energy: SIX_PERIOD_ENERGY, demand: [], flatDemand: [] },
  },
  "B-6": {
    name: "B-6 Small General Service TOU Poly Phase",
    periods: {
      energy: ["Super Off-Peak Winter", "Off-Peak Winter", "Peak Winter", "Off-Peak Summer", "Peak Summer"],
      demand: [],
      flatDemand: [],
    },
  },
  "B-10": {
    name: "B-10 Medium General Demand Service (Secondary Voltage)",
    periods: { energy: SIX_PERIOD_ENERGY, demand: [], flatDemand: ["Maximum Demand A", "Maximum Demand B"] },
  },
  "B-19": {
    name: "B-19 Medium General Demand TOU (Secondary) Voluntary",
    periods: {
      energy: SIX_PERIOD_ENERGY,
      demand: ["Off-Peak Demand", "Maximum Peak Demand Winter", "Maximum Part-Peak Demand Summer", "Maximum Peak Demand Summer"],
      flatDemand: ["Maximum Demand A", "Maximum Demand B"],
    },
  },
};

const isoDate = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
// toFixed drops float noise from rate + adj without touching a real rate's digits.
const usd = ({ rate, adj }: z.infer<typeof UrdbTier>) => Number((rate + (adj ?? 0)).toFixed(10));

function named(kind: string, count: number, names: string[]) {
  if (count !== names.length) throw new Error(`Expected ${names.length} ${kind} periods, URDB has ${count}`);
  return names;
}

function requireKw(unit: string | undefined, field: string) {
  if (unit !== "kW") throw new Error(`Cannot price ${field} in "${unit}", only kW`);
}

export function normalizeUrdb(input: unknown, schedule: RateSchedule, names: PeriodNames): Tariff {
  const record = UrdbRecord.parse(input);
  if (record.mincharge) throw new Error(`Cannot price a minimum charge on ${record.label}`);

  const energy = record.energyratestructure;
  const demand = record.demandratestructure ?? [];
  const flat = record.flatdemandstructure ?? [];
  if (demand.length) requireKw(record.demandrateunit, "demandrateunit");
  if (flat.length) requireKw(record.flatdemandunit, "flatdemandunit");
  for (const tier of energy.flat()) {
    if (tier.unit !== "kWh") throw new Error(`Cannot price energy in "${tier.unit}", only kWh`);
  }

  const fixedPer = { "$/day": "day", "$/month": "month" } as const;
  const per = fixedPer[record.fixedchargeunits as keyof typeof fixedPer];
  if (record.fixedchargefirstmeter && !per) {
    throw new Error(`Cannot price a fixed charge in "${record.fixedchargeunits}"`);
  }

  const energyNames = named("energy", energy.length, names.energy);
  // The last tier is open ended whatever URDB says, as usage above it still has to be priced.
  const demandPeriods = (periods: typeof demand, periodNames: string[]) =>
    periods.map((tiers, index) => ({
      name: periodNames[index],
      tiers: tiers.map((tier, i) => ({ upToKw: i === tiers.length - 1 ? null : tier.max, usdPerKw: usd(tier) })),
    }));

  return Tariff.parse({
    schedule,
    source: "urdb",
    sourceId: record.label,
    effectiveStart: isoDate(record.startdate),
    updatedAt: isoDate(Math.max(record.startdate, ...record.revisions)),
    energyWeekdaySchedule: record.energyweekdayschedule,
    energyWeekendSchedule: record.energyweekendschedule,
    energyPeriods: energy.map((tiers, index) => ({
      name: energyNames[index],
      tiers: tiers.map((tier, i) => ({ upToKwh: i === tiers.length - 1 ? null : tier.max, usdPerKwh: usd(tier) })),
    })),
    demandWeekdaySchedule: demand.length ? record.demandweekdayschedule : null,
    demandWeekendSchedule: demand.length ? record.demandweekendschedule : null,
    demandPeriods: demandPeriods(demand, named("demand", demand.length, names.demand)),
    flatDemandMonths: flat.length ? record.flatdemandmonths : null,
    flatDemandPeriods: demandPeriods(flat, named("flat demand", flat.length, names.flatDemand)),
    fixedCharges: record.fixedchargefirstmeter
      ? [{ name: "Customer Charge", usd: record.fixedchargefirstmeter, per }]
      : [],
  });
}

// Current means no end date. More than one match means the name no longer identifies a single rate.
export function pickCurrentRecord<T extends { name?: unknown; enddate?: unknown }>(records: T[], name: string): T {
  const matches = records.filter((record) => record.name === name && record.enddate == null);
  if (matches.length !== 1) throw new Error(`Expected one current URDB record named "${name}", found ${matches.length}`);
  return matches[0]!;
}
