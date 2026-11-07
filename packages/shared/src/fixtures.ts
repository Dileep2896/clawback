import { z } from "zod";

// The one place the gas supplier is named.
export const GAS_SUPPLIER = { provider: "bayhearth", name: "BayHearth Energy" } as const;

export const Provider = z.enum(["baycurrent", "baytel", "bayconnect", GAS_SUPPLIER.provider]);
export type Provider = z.infer<typeof Provider>;

export const ServiceType = z.enum(["electric", "gas", "telecom", "internet"]);
export type ServiceType = z.infer<typeof ServiceType>;

export const PhoneLinePurpose = z.enum(["unknown", "fax", "alarm", "voice"]);
export type PhoneLinePurpose = z.infer<typeof PhoneLinePurpose>;

const id = z.string().min(1);
const cents = z.number().int();
const timestamp = z.iso.datetime({ offset: true });

export const TouKwh = z.strictObject({ period: z.string().min(1), kwh: z.number().nonnegative() });
export type TouKwh = z.infer<typeof TouKwh>;

export const CustomerFixture = z.strictObject({
  id,
  name: z.string().min(1),
  contactName: z.string().min(1),
  contactEmail: z.string().min(1),
  contactPhone: z.string().min(1),
  savingsSharePct: z.number().int().min(0).max(100),
});
export type CustomerFixture = z.infer<typeof CustomerFixture>;

export const LocationFixture = z.strictObject({
  id,
  customerId: id,
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
});
export type LocationFixture = z.infer<typeof LocationFixture>;

export const AccountFixture = z.strictObject({
  id,
  locationId: id,
  provider: Provider,
  accountNumber: z.string().min(1),
  serviceType: ServiceType,
  rateSchedule: z.string().min(1).nullable(),
  meterNumber: z.string().min(1).nullable(),
});
export type AccountFixture = z.infer<typeof AccountFixture>;

export const AuthorizationFixture = z.strictObject({
  id,
  customerId: id,
  provider: Provider,
  formType: z.string().min(1),
  scope: z.string().min(1),
  signedBy: z.string().min(1),
  signedAt: timestamp,
  expiresAt: timestamp,
  pdfPath: z.string().min(1).nullable(),
});
export type AuthorizationFixture = z.infer<typeof AuthorizationFixture>;

export const BillLineFixture = z.strictObject({
  id,
  description: z.string().min(1),
  quantity: z.number().nullable(),
  unit: z.string().min(1).nullable(),
  rate: z.number().nullable(),
  amountCents: cents,
  lineType: z.string().min(1),
});
export type BillLineFixture = z.infer<typeof BillLineFixture>;

// Meter, multiplier and schedule sit on each bill because the Fremont swap changes them mid-history.
export const BillFixture = z.strictObject({
  id,
  accountId: id,
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  totalCents: cents,
  pdfPath: z.string().min(1).nullable(),
  meterNumber: z.string().min(1).nullable(),
  multiplier: z.number().positive().nullable(),
  rateSchedule: z.string().min(1).nullable(),
  planCode: z.string().min(1).nullable(),
  kwhByTouPeriod: z.array(TouKwh),
  maxKw: z.number().nonnegative().nullable(),
  lines: z.array(BillLineFixture).min(1),
});
export type BillFixture = z.infer<typeof BillFixture>;

export const PhoneLineFixture = z.strictObject({
  id,
  accountId: id,
  number: z.string().min(1),
  label: z.string().min(1),
  monthlyCents: cents.nonnegative(),
  callsLast12mo: z.number().int().nonnegative(),
  purpose: PhoneLinePurpose,
});
export type PhoneLineFixture = z.infer<typeof PhoneLineFixture>;

export const UsageIntervalFixture = z.strictObject({
  accountId: id,
  ts: timestamp,
  kwh: z.number().nonnegative(),
});
export type UsageIntervalFixture = z.infer<typeof UsageIntervalFixture>;
