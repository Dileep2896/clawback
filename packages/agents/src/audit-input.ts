import { fileURLToPath } from "node:url";
import type { AuditRun } from "@bill-fighter/core/rules/index";
import type { AuditInput } from "@bill-fighter/core/rules/input";
import { loadTariff } from "@bill-fighter/core/tariff/load";
import { generateSeed, type Seed } from "@bill-fighter/db/seed/generate";
import { BillFixture } from "@bill-fighter/shared/fixtures";
import type { RateSchedule, Tariff } from "@bill-fighter/shared/tariff";
import { readParsedDir, type CachedParse } from "./parse-cache.ts";

export const PARSED_DIR = fileURLToPath(new URL("../../../data/parsed", import.meta.url));

// Section 7 of the project plan.
export const EXPECTED_TOTALS = { refundCents: 1_260_000, annualSavingsCents: 2_000_000 };
const MAX_DRIFT_PERCENT = 10;

// Bills come only from cached parses. A miss throws, because there is no model here to fall back on.
export function parsedBills(
  seed: { accounts: Pick<Seed["accounts"][number], "id" | "accountNumber">[]; bills: Pick<BillFixture, "id" | "accountId">[] },
  entries: Pick<CachedParse, "source" | "status" | "bill" | "problems">[],
): BillFixture[] {
  const problems: string[] = [];
  const entryBySource = new Map(entries.map((entry) => [entry.source, entry]));
  const seedBillIds = new Set(seed.bills.map((b) => b.id));
  const accountNumbers = new Map(seed.accounts.map((a) => [a.id, a.accountNumber]));

  for (const entry of entries) {
    if (!seedBillIds.has(entry.source)) problems.push(`${entry.source}: not a seed bill`);
  }
  const bills = seed.bills.flatMap((seedBill) => {
    const entry = entryBySource.get(seedBill.id);
    if (!entry) {
      problems.push(`${seedBill.id}: no cached parse`);
      return [];
    }
    if (entry.status !== "parsed" || !entry.bill) {
      problems.push(`${seedBill.id}: ${entry.status}, ${entry.problems.join("; ")}`);
      return [];
    }
    const { accountNumber, periodStart, periodEnd, totalCents, meterNumber, multiplier, rateSchedule, planCode, kwhByTouPeriod, maxKw, lineItems } = entry.bill;
    if (accountNumber !== accountNumbers.get(seedBill.accountId)) {
      problems.push(`${seedBill.id}: account number ${accountNumber} is not on account ${seedBill.accountId}`);
      return [];
    }
    return [
      BillFixture.parse({
        id: seedBill.id,
        accountId: seedBill.accountId,
        periodStart,
        periodEnd,
        totalCents,
        pdfPath: null,
        meterNumber,
        multiplier,
        rateSchedule,
        planCode,
        kwhByTouPeriod,
        maxKw,
        // The seed's own line ids, so evidence points at lines the database also has.
        lines: lineItems.map((line, index) => ({ id: `${seedBill.id}-${index + 1}`, ...line })),
      }),
    ];
  });

  if (problems.length > 0) throw new Error(`Parse cache cannot cover the audit, ${problems.length} problem(s). Parse ahead of time with scripts/parse-bills.ts:\n  ${problems.join("\n  ")}`);
  return bills;
}

export function tariffLoader(): AuditInput["tariffFor"] {
  const tariffs = new Map<RateSchedule, Tariff>();
  return (schedule) => {
    const tariff = tariffs.get(schedule) ?? loadTariff(schedule);
    tariffs.set(schedule, tariff);
    return tariff;
  };
}

// Offline: committed parsed JSON, plus the seed generator for what a bill does not carry.
export function loadAuditInput(parsedDir = PARSED_DIR): AuditInput {
  const seed = generateSeed();
  return {
    customerId: seed.customer.id,
    accounts: seed.accounts,
    bills: parsedBills(seed, readParsedDir(parsedDir)),
    phoneLines: seed.phoneLines,
    intervals: seed.intervals,
    tariffFor: tariffLoader(),
  };
}

// Whole numbers, so exactly 10% cannot fail on float noise.
export function totalsProblems({ refundCents, annualSavingsCents }: Pick<AuditRun, "refundCents" | "annualSavingsCents">) {
  const drifted = (cents: number, expected: number) => Math.abs(cents - expected) * 100 > expected * MAX_DRIFT_PERCENT;
  return [
    ...(drifted(refundCents, EXPECTED_TOTALS.refundCents) ? [`Refund ${refundCents} cents is more than ${MAX_DRIFT_PERCENT}% from ${EXPECTED_TOTALS.refundCents}`] : []),
    ...(drifted(annualSavingsCents, EXPECTED_TOTALS.annualSavingsCents) ? [`Yearly savings ${annualSavingsCents} cents is more than ${MAX_DRIFT_PERCENT}% from ${EXPECTED_TOTALS.annualSavingsCents}`] : []),
  ];
}
