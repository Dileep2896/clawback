import { FindingEvidence } from "@bill-fighter/shared/finding";
import { z } from "zod";

const cents = z.number().int();

// Parsed, so a rule changing its detail shows "could not be read" in front of the room instead of "$NaN".
const meter = z.object({
  swapMonth: z.string(),
  oldMeter: z.string(),
  newMeter: z.string(),
  kwhRatio: z.number(),
  bills: z.array(
    z.object({
      billId: z.string(),
      periodStart: z.string(),
      billedKwh: z.number(),
      intervalKwh: z.number(),
      billedCents: cents,
      correctCents: cents,
      overbilledCents: cents,
    }),
  ),
});
const rate = z.object({
  currentSchedule: z.string(),
  proposedSchedule: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  peakKw: z.number(),
  heldKw: z.number(),
  schedules: z.array(z.object({ schedule: z.string(), annualCents: cents, savingsPct: z.number() })),
  months: z.array(z.object({ billId: z.string(), periodStart: z.string(), currentCents: cents, proposedCents: cents, savingsPct: z.number() })),
});
const line = z.object({
  number: z.string(),
  label: z.string().nullable(),
  purpose: z.string(),
  callsLast12mo: z.number().int(),
  monthlyCents: cents,
  action: z.enum(["cancel", "confirmWithAlarmCompany"]),
});
const promo = z.object({ planCode: z.string(), riseMonth: z.string(), beforeCents: cents, afterCents: cents, latestCents: cents, monthlyIncreaseCents: cents });
const arithmetic = z.object({ linesCents: cents, totalCents: cents, differenceCents: cents });
const supplier = z.object({ supplier: z.string(), utility: z.string(), planCode: z.string().nullable() });

export type MeterDetail = z.infer<typeof meter>;
export type RateDetail = z.infer<typeof rate>;

export type Evidence =
  | { type: "meterMultiplierJump"; detail: MeterDetail }
  | { type: "rateOptimization"; detail: RateDetail }
  | { type: "unusedLines"; detail: z.infer<typeof line> }
  | { type: "promoExpiry"; detail: z.infer<typeof promo> }
  | { type: "arithmeticCheck"; detail: z.infer<typeof arithmetic> }
  | { type: "thirdPartySupplier"; detail: z.infer<typeof supplier> };

const DETAIL = { meterMultiplierJump: meter, rateOptimization: rate, unusedLines: line, promoExpiry: promo, arithmeticCheck: arithmetic, thirdPartySupplier: supplier };

/** Null when the row is not what the rules write, so the drawer can say so. */
export function parseEvidence(type: string, evidenceJson: unknown): Evidence | null {
  const schema = DETAIL[type as keyof typeof DETAIL];
  const evidence = FindingEvidence.safeParse(evidenceJson);
  if (!schema || !evidence.success) return null;
  const detail = schema.safeParse(evidence.data.detail);
  return detail.success ? ({ type, detail: detail.data } as Evidence) : null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const money = (amountCents: number) => usd.format(amountCents / 100);
export const quantity = (value: number) => number.format(value);
/** Short month name from "2025-09" or "2025-09-01". Reads the text, because a Date would shift the month in a timezone west of UTC. */
export const monthName = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1]!;
export const monthLabel = (date: string) => `${monthName(date)} ${date.slice(0, 4)}`;
