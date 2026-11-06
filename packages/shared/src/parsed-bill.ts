import { z } from "zod";
import { ServiceType, TouKwh } from "./fixtures.ts";

export const ParsedBillLine = z.strictObject({
  description: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  rate: z.number().nullable(),
  amountCents: z.number().int(),
  lineType: z.string(),
});
export type ParsedBillLine = z.infer<typeof ParsedBillLine>;

// Output of LLM extraction. Absent values are null rather than optional, and TOU usage is an array
// rather than a record, so this converts to a JSON schema where every object is closed.
// Free text provider and schedule: the real PG&E sample bill has to parse too.
export const ParsedBill = z.strictObject({
  accountNumber: z.string(),
  serviceAddress: z.string().nullable(),
  providerName: z.string(),
  serviceType: ServiceType,
  meterNumber: z.string().nullable(),
  multiplier: z.number().nullable(),
  rateSchedule: z.string().nullable(),
  planCode: z.string().nullable(),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  kwhByTouPeriod: z.array(TouKwh),
  maxKw: z.number().nullable(),
  lineItems: z.array(ParsedBillLine),
  totalCents: z.number().int(),
});
export type ParsedBill = z.infer<typeof ParsedBill>;
