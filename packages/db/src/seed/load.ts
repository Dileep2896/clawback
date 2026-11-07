import { and, eq, getTableColumns, inArray, notInArray, sql } from "drizzle-orm";
import type { createDb } from "../client.ts";
import { accounts, authorizations, billLines, bills, customers, locations, phoneLines, usageIntervals } from "../schema.ts";
import { billPdfPath } from "./bill-pdf.ts";
import type { Seed } from "./generate.ts";

type Db = ReturnType<typeof createDb>;
type Parent = typeof customers | typeof locations | typeof accounts | typeof authorizations | typeof bills;

// Updates only the columns the rows carry, so a re-seed keeps a bill's parsed_json and parse_confidence.
function onConflict(table: Parent, rows: object[]) {
  const columns: Record<string, { name: string }> = getTableColumns(table);
  const keys = Object.keys(rows[0]!).filter((key) => key !== "id");
  return {
    target: table.id,
    set: Object.fromEntries(keys.map((key) => [key, sql.raw(`excluded."${columns[key]!.name}"`)])),
  };
}

// One transaction, so a failed seed leaves the database as it was. Runs and findings are demo-reset's to clear.
export async function loadSeed(db: Db, seed: Seed) {
  const customerId = seed.customer.id;
  const authorizationRows = seed.authorizations.map((row) => ({
    ...row,
    signedAt: new Date(row.signedAt),
    expiresAt: new Date(row.expiresAt),
  }));
  const billRows = seed.bills.map((bill) => ({
    id: bill.id,
    accountId: bill.accountId,
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    totalCents: bill.totalCents,
    pdfPath: billPdfPath(bill),
  }));

  await db.transaction(async (tx) => {
    await tx.insert(customers).values(seed.customer).onConflictDoUpdate(onConflict(customers, [seed.customer]));
    await tx.insert(authorizations).values(authorizationRows).onConflictDoUpdate(onConflict(authorizations, authorizationRows));
    await tx.insert(locations).values(seed.locations).onConflictDoUpdate(onConflict(locations, seed.locations));
    await tx.insert(accounts).values(seed.accounts).onConflictDoUpdate(onConflict(accounts, seed.accounts));
    await tx.insert(bills).values(billRows).onConflictDoUpdate(onConflict(bills, billRows));

    const customerLocations = tx.select({ id: locations.id }).from(locations).where(eq(locations.customerId, customerId));
    const customerAccounts = tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.locationId, customerLocations));
    const customerBills = tx.select({ id: bills.id }).from(bills).where(inArray(bills.accountId, customerAccounts));

    // Nothing references these three, so they are replaced outright.
    await tx.delete(billLines).where(inArray(billLines.billId, customerBills));
    await tx.delete(phoneLines).where(inArray(phoneLines.accountId, customerAccounts));
    await tx.delete(usageIntervals).where(inArray(usageIntervals.accountId, customerAccounts));

    // Children first. A finding on a stale account fails the foreign key and rolls everything back.
    await tx.delete(bills).where(and(inArray(bills.accountId, customerAccounts), notInArray(bills.id, seed.bills.map((b) => b.id))));
    await tx.delete(accounts).where(and(inArray(accounts.locationId, customerLocations), notInArray(accounts.id, seed.accounts.map((a) => a.id))));
    await tx.delete(locations).where(and(eq(locations.customerId, customerId), notInArray(locations.id, seed.locations.map((l) => l.id))));
    await tx.delete(authorizations).where(and(eq(authorizations.customerId, customerId), notInArray(authorizations.id, seed.authorizations.map((a) => a.id))));

    await tx.insert(billLines).values(seed.bills.flatMap((bill) => bill.lines.map((line) => ({ ...line, billId: bill.id }))));
    await tx.insert(phoneLines).values(seed.phoneLines);

    // One statement with three array parameters: 432,288 rows would pass Postgres's 65,535 parameter limit as a VALUES list.
    const intervals = Object.values(seed.intervals).flat();
    await tx.execute(sql`
      INSERT INTO usage_intervals (account_id, ts, kwh)
      SELECT * FROM unnest(
        ${sql.param(intervals.map((row) => row.accountId))}::text[],
        ${sql.param(intervals.map((row) => row.ts))}::timestamptz[],
        ${sql.param(intervals.map((row) => row.kwh))}::numeric[]
      )`);
  });
}
