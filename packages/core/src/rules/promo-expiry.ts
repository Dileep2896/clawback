import type { BillFixture } from "@bill-fighter/shared/fixtures";
import { Finding } from "@bill-fighter/shared/finding";
import { billsOf, dollars, type AuditInput } from "./input.ts";

const usage = (bill: BillFixture) =>
  JSON.stringify([bill.lines.map((l) => [l.description, l.quantity, l.unit]), bill.kwhByTouPeriod, bill.maxKw]);

// Whole numbers, so exactly 30% cannot pass on float noise.
const upOver30Percent = (from: BillFixture, to: BillFixture) => to.totalCents * 100 > from.totalCents * 130;

export function promoExpiry(input: AuditInput): Finding[] {
  return input.accounts.flatMap((account) => {
    const bills = billsOf(input, account.id);
    const latest = bills.at(-1);
    for (let i = 1; i < bills.length; i++) {
      const before = bills[i - 1]!;
      const after = bills[i]!;
      if (before.planCode === null || before.planCode !== after.planCode) continue;
      if (!upOver30Percent(before, after) || usage(before) !== usage(after)) continue;
      // Savings come from the latest bill, so it must still be the same deal at the higher price.
      if (latest!.planCode !== before.planCode || usage(latest!) !== usage(before) || !upOver30Percent(before, latest!)) continue;

      const monthlyIncreaseCents = latest!.totalCents - before.totalCents;
      const annualSavingsCents = monthlyIncreaseCents * 12;
      const riseMonth = after.periodStart.slice(0, 7);
      // One per account: the first rise already measures up to the latest price, so a second would double count.
      return [
        Finding.parse({
          customerId: input.customerId,
          accountId: account.id,
          type: "promoExpiry",
          title: `Monthly charge up ${dollars(monthlyIncreaseCents)} on plan ${before.planCode}`,
          explanation:
            `Plan ${before.planCode} went from ${dollars(before.totalCents)} to ${dollars(after.totalCents)} a month in ${riseMonth} with no change in usage, which points to an expired promo. ` +
            `The latest bill is ${dollars(latest!.totalCents)}. Restoring the earlier price saves ${dollars(annualSavingsCents)} a year.`,
          evidence: {
            billIds: [before.id, after.id],
            billLineIds: [...before.lines, ...after.lines].map((l) => l.id),
            phoneLineIds: [],
            detail: {
              planCode: before.planCode,
              riseMonth,
              beforeCents: before.totalCents,
              afterCents: after.totalCents,
              latestCents: latest!.totalCents,
              monthlyIncreaseCents,
            },
          },
          refundCents: 0,
          annualSavingsCents,
          confidence: 0.8,
        }),
      ];
    }
    return [];
  });
}
