import { z } from "zod";

export const RateSchedule = z.enum(["B-1", "B-6", "B-10", "B-19"]);
export type RateSchedule = z.infer<typeof RateSchedule>;

// 12 months x 24 hours of indexes into a period list.
const ScheduleGrid = z.array(z.array(z.number().int().nonnegative()).length(24)).length(12);
type ScheduleGrid = z.infer<typeof ScheduleGrid>;

const EnergyTier = z.strictObject({
  upToKwh: z.number().positive().nullable(),
  usdPerKwh: z.number(),
});
const DemandTier = z.strictObject({
  upToKw: z.number().positive().nullable(),
  usdPerKw: z.number(),
});

// The last tier must be open ended, or usage above it would have no price.
const EnergyPeriod = z.strictObject({
  name: z.string().min(1),
  tiers: z
    .array(EnergyTier)
    .min(1)
    .refine((tiers) => tiers.at(-1)?.upToKwh === null, "The last tier must have upToKwh null"),
});
const DemandPeriod = z.strictObject({
  name: z.string().min(1),
  tiers: z
    .array(DemandTier)
    .min(1)
    .refine((tiers) => tiers.at(-1)?.upToKw === null, "The last tier must have upToKw null"),
});

const FixedCharge = z.strictObject({
  name: z.string().min(1),
  usd: z.number(),
  per: z.enum(["day", "month"]),
});

export const Tariff = z
  .strictObject({
    schedule: RateSchedule,
    source: z.enum(["urdb", "fallback"]),
    sourceId: z.string().min(1),
    effectiveStart: z.iso.date(),
    updatedAt: z.iso.date(),
    energyWeekdaySchedule: ScheduleGrid,
    energyWeekendSchedule: ScheduleGrid,
    energyPeriods: z.array(EnergyPeriod).min(1),
    demandWeekdaySchedule: ScheduleGrid.nullable(),
    demandWeekendSchedule: ScheduleGrid.nullable(),
    demandPeriods: z.array(DemandPeriod),
    flatDemandMonths: z.array(z.number().int().nonnegative()).length(12).nullable(),
    flatDemandPeriods: z.array(DemandPeriod),
    fixedCharges: z.array(FixedCharge),
  })
  .superRefine((tariff, ctx) => {
    const check = (name: string, indexes: number[] | null, periodCount: number) => {
      if (indexes?.some((index) => index >= periodCount)) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `Points at a period that does not exist (${periodCount} defined)`,
        });
      }
    };
    const flat = (grid: ScheduleGrid | null) => grid?.flat() ?? null;
    check("energyWeekdaySchedule", flat(tariff.energyWeekdaySchedule), tariff.energyPeriods.length);
    check("energyWeekendSchedule", flat(tariff.energyWeekendSchedule), tariff.energyPeriods.length);
    check("demandWeekdaySchedule", flat(tariff.demandWeekdaySchedule), tariff.demandPeriods.length);
    check("demandWeekendSchedule", flat(tariff.demandWeekendSchedule), tariff.demandPeriods.length);
    check("flatDemandMonths", tariff.flatDemandMonths, tariff.flatDemandPeriods.length);
    if ((tariff.demandWeekdaySchedule === null) !== (tariff.demandWeekendSchedule === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["demandWeekendSchedule"],
        message: "Weekday and weekend demand schedules must both be set or both be null",
      });
    }
  });
export type Tariff = z.infer<typeof Tariff>;
