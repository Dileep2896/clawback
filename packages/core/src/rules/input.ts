import type { AccountFixture, BillFixture, PhoneLineFixture } from "@bill-fighter/shared/fixtures";
import type { RateSchedule, Tariff } from "@bill-fighter/shared/tariff";
import type { Interval } from "../tariff/price-usage.ts";

export type AuditInput = {
  customerId: string;
  // A plain string, because rules compare providers and never name one.
  accounts: (Omit<AccountFixture, "provider"> & { provider: string })[];
  bills: BillFixture[];
  phoneLines: PhoneLineFixture[];
  // Keyed by electric account id.
  intervals: Record<string, Interval[]>;
  // Injected so rules never read a file. The caller passes loadTariff.
  tariffFor: (schedule: RateSchedule) => Tariff;
};

// Oldest first.
export const billsOf = (input: AuditInput, accountId: string) =>
  input.bills.filter((b) => b.accountId === accountId).sort((a, b) => a.periodStart.localeCompare(b.periodStart));

export const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
