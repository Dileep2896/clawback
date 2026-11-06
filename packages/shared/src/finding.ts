import { z } from "zod";

export const FindingType = z.enum([
  "meterMultiplierJump",
  "rateOptimization",
  "unusedLines",
  "promoExpiry",
  "arithmeticCheck",
  "thirdPartySupplier",
]);
export type FindingType = z.infer<typeof FindingType>;

export const FindingStatus = z.enum(["proposed", "approved", "filed", "won", "rejected"]);
export type FindingStatus = z.infer<typeof FindingStatus>;

const id = z.string().min(1);

export const FindingEvidence = z
  .object({
    billIds: z.array(id),
    billLineIds: z.array(id),
    phoneLineIds: z.array(id),
    detail: z.record(z.string(), z.unknown()),
  })
  .refine((e) => e.billIds.length + e.billLineIds.length + e.phoneLineIds.length > 0, {
    message: "A finding must point at the bills, bill lines or phone lines that prove it",
  });
export type FindingEvidence = z.infer<typeof FindingEvidence>;

export const Finding = z.object({
  customerId: id,
  accountId: id,
  type: FindingType,
  title: z.string().min(1),
  explanation: z.string().min(1),
  evidence: FindingEvidence,
  refundCents: z.number().int().nonnegative(),
  annualSavingsCents: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  status: FindingStatus.default("proposed"),
});
export type Finding = z.infer<typeof Finding>;
