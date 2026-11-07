import type { ParsedBill } from "@bill-fighter/shared/parsed-bill";

const KWH_TOLERANCE = 0.01;

// Model output is untrusted. An empty list is caught here because it would otherwise sum cleanly to a total of 0.
export function validateParsedBill(bill: ParsedBill): string[] {
  const problems: string[] = [];
  if (bill.periodEnd < bill.periodStart) problems.push(`Period ends ${bill.periodEnd} before it starts ${bill.periodStart}`);
  if (bill.lineItems.length === 0) problems.push("The bill has no line items");

  const linesCents = bill.lineItems.reduce((sum, line) => sum + line.amountCents, 0);
  if (linesCents !== bill.totalCents) problems.push(`Lines sum to ${linesCents} cents but the total is ${bill.totalCents} cents`);

  const kwhLines = bill.lineItems.filter((line) => /^kwh$/i.test(line.unit ?? "") && line.quantity !== null && line.rate !== null);
  for (const line of kwhLines) {
    const expectedCents = line.quantity! * line.rate! * 100;
    if (Math.abs(expectedCents - line.amountCents) > Math.abs(line.amountCents) * KWH_TOLERANCE) {
      problems.push(`"${line.description}": ${line.quantity} kWh x $${line.rate} misses ${line.amountCents} cents by more than 1%`);
    }
  }
  // Otherwise a model that returned null rates would pass by skipping the check above.
  if (bill.serviceType === "electric" && kwhLines.length === 0) problems.push("An electric bill has no kWh line with a quantity and a rate");
  return problems;
}
