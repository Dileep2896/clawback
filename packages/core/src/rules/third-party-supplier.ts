import { Finding } from "@bill-fighter/shared/finding";
import { billsOf, type AuditInput } from "./input.ts";

// A contract review flag only: $0, and the wording must never advise changing supplier.
export function thirdPartySupplier(input: AuditInput): Finding[] {
  return input.accounts
    .filter((account) => account.serviceType === "gas")
    .flatMap((account) => {
      const utility = input.accounts.find((a) => a.locationId === account.locationId && a.serviceType === "electric");
      const bills = billsOf(input, account.id);
      if (!utility || utility.provider === account.provider || bills.length === 0) return [];
      const planCode = bills.at(-1)!.planCode;
      return [
        Finding.parse({
          customerId: input.customerId,
          accountId: account.id,
          type: "thirdPartySupplier",
          title: "Review contract, check exit fees",
          explanation: `Gas at this location comes from a third party supplier${planCode ? ` on plan ${planCode}` : ""}, not the local utility. Review the contract and check exit fees.`,
          evidence: {
            billIds: bills.map((b) => b.id),
            billLineIds: [],
            phoneLineIds: [],
            detail: { supplier: account.provider, utility: utility.provider, planCode },
          },
          refundCents: 0,
          annualSavingsCents: 0,
          confidence: 0.5,
        }),
      ];
    });
}
