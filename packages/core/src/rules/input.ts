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

const MS_PER_DAY = 86_400_000;

// Oldest first. Bills with overlapping periods are all left out: we never guess which reissue stands, so under-claiming
// is the failure we accept. Period ends are inclusive, so one shared day is an overlap.
export const billsOf = (input: AuditInput, accountId: string) => {
  const bills = input.bills.filter((b) => b.accountId === accountId).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  return bills.filter((b, i) => !bills.some((o, j) => i !== j && o.periodStart <= b.periodEnd && b.periodStart <= o.periodEnd));
};

// Includes bills billsOf leaves out: a newer reissue may have corrected the price, so an older bill can't count as latest.
export const latestPeriodEnd = (input: AuditInput, accountId: string) =>
  input.bills.filter((b) => b.accountId === accountId).reduce((latest, b) => (b.periodEnd > latest ? b.periodEnd : latest), "");

// Truly adjacent: no gap and no overlap. Period ends are inclusive, so the next bill starts the day after.
export const followsOn = (earlier: BillFixture, later: BillFixture) =>
  new Date(Date.parse(earlier.periodEnd) + MS_PER_DAY).toISOString().slice(0, 10) === later.periodStart;

export const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
