import type { Finding } from "@bill-fighter/shared/finding";
import { arithmeticCheck } from "./arithmetic-check.ts";
import type { AuditInput } from "./input.ts";
import { meterMultiplierJump } from "./meter-multiplier.ts";
import { promoExpiry } from "./promo-expiry.ts";
import { rateOptimization } from "./rate-optimization.ts";
import { thirdPartySupplier } from "./third-party-supplier.ts";
import { findingTotals } from "./totals.ts";
import { unusedLines } from "./unused-lines.ts";

export const RULES = [meterMultiplierJump, rateOptimization, unusedLines, promoExpiry, arithmeticCheck, thirdPartySupplier];

export type AuditRun = { findings: Finding[]; refundCents: number; annualSavingsCents: number };

export function runAudit(input: AuditInput): AuditRun {
  const findings = RULES.flatMap((rule) => rule(input));
  return { findings, ...findingTotals(findings) };
}
