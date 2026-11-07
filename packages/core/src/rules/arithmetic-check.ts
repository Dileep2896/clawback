import { Finding } from "@bill-fighter/shared/finding";
import { dollars, type AuditInput } from "./input.ts";

// $0 on purpose: a mismatch can be a prior balance or a parsing slip, so it is a flag and not a refund claim.
export function arithmeticCheck(input: AuditInput): Finding[] {
  return input.bills.flatMap((bill) => {
    const linesCents = bill.lines.reduce((sum, line) => sum + line.amountCents, 0);
    const differenceCents = bill.totalCents - linesCents;
    if (differenceCents === 0) return [];
    return [
      Finding.parse({
        customerId: input.customerId,
        accountId: bill.accountId,
        type: "arithmeticCheck",
        title: `Bill lines do not add up to the total on bill ${bill.id}`,
        explanation: `The lines add up to ${dollars(linesCents)} but the bill total is ${dollars(bill.totalCents)}. Flagged for review, with no refund claimed.`,
        evidence: {
          billIds: [bill.id],
          billLineIds: bill.lines.map((l) => l.id),
          phoneLineIds: [],
          detail: { linesCents, totalCents: bill.totalCents, differenceCents },
        },
        refundCents: 0,
        annualSavingsCents: 0,
        confidence: 0.9,
      }),
    ];
  });
}
