import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditInput } from "@bill-fighter/core/rules/input";
import type { Db } from "@bill-fighter/db/client";
import { accounts, bills, locations, phoneLines, usageIntervals } from "@bill-fighter/db/schema";
import { PhoneLineFixture } from "@bill-fighter/shared/fixtures";
import { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { parsedBills, tariffLoader } from "./audit-input.ts";

/** Not bills.pdf_path: the portal serves from that column, and only inside data/bills/. */
export const RUNS_DIR = join(tmpdir(), "bill-fighter-runs");

export const runPaths = (runId: string, root: string = RUNS_DIR) => ({
  // Named by account, so store_bill can check the bill was offered under the account the database has it on.
  downloadedBills: join(root, runId, "downloads", "bills"),
  downloadedUsage: join(root, runId, "downloads", "usage"),
  storedBills: join(root, runId, "bills"),
});

export const customerAccounts = (db: Db, customerId: string) =>
  db
    .select(getTableColumns(accounts))
    .from(accounts)
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(eq(locations.customerId, customerId))
    .orderBy(asc(accounts.id));

export const customerBills = (db: Db, customerId: string) =>
  db
    .select(getTableColumns(bills))
    .from(bills)
    .innerJoin(accounts, eq(bills.accountId, accounts.id))
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(eq(locations.customerId, customerId))
    .orderBy(asc(bills.id));

/** Throws if any bill has no parse, so an audit can never quietly cover fewer bills. */
export async function loadCustomerAuditInput(db: Db, customerId: string): Promise<AuditInput> {
  const [accountRows, billRows] = await Promise.all([customerAccounts(db, customerId), customerBills(db, customerId)]);
  if (accountRows.length === 0) throw new Error(`Customer ${customerId} has no accounts on file`);
  const accountIds = accountRows.map((account) => account.id);

  const entries = billRows.flatMap((bill) =>
    bill.parsedJson ? [{ source: bill.id, status: "parsed" as const, bill: ParsedBill.parse(bill.parsedJson), problems: [] }] : [],
  );
  const [lineRows, usageRows] = await Promise.all([
    db.select().from(phoneLines).where(inArray(phoneLines.accountId, accountIds)),
    db.select().from(usageIntervals).where(inArray(usageIntervals.accountId, accountIds)).orderBy(asc(usageIntervals.ts)),
  ]);

  const intervals: AuditInput["intervals"] = {};
  for (const { accountId, ts, kwh } of usageRows) (intervals[accountId] ??= []).push({ ts, kwh });

  return {
    customerId,
    accounts: accountRows,
    bills: parsedBills({ accounts: accountRows, bills: billRows }, entries),
    phoneLines: lineRows.map((line) => PhoneLineFixture.parse(line)),
    intervals,
    tariffFor: tariffLoader(),
  };
}
