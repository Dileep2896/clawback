import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@bill-fighter/db/client";
import { accounts, bills, locations } from "@bill-fighter/db/schema";
import type { Provider } from "@bill-fighter/shared/fixtures";

// next dev and next start both run from apps/portal, and bills.pdf_path is relative to the repo root.
const REPO_ROOT = resolve(process.cwd(), "../..");

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (cents: number) => usd.format(cents / 100);

/** Null when the account is not this provider's, so one login cannot read another's bills by guessing an id. */
export async function listBills(db: Db, provider: Provider, accountId: string) {
  const [account] = await db
    .select({ accountNumber: accounts.accountNumber, locationName: locations.name })
    .from(accounts)
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(and(eq(accounts.id, accountId), eq(accounts.provider, provider)));
  if (!account) return null;

  const rows = await db
    .select({ id: bills.id, periodStart: bills.periodStart, periodEnd: bills.periodEnd, totalCents: bills.totalCents })
    .from(bills)
    .where(eq(bills.accountId, accountId))
    .orderBy(asc(bills.periodStart));
  return { account, rows };
}

export async function findBill(db: Db, provider: Provider, billId: string) {
  const [bill] = await db
    .select({ id: bills.id, pdfPath: bills.pdfPath })
    .from(bills)
    .innerJoin(accounts, eq(bills.accountId, accounts.id))
    .where(and(eq(bills.id, billId), eq(accounts.provider, provider)));
  return bill ?? null;
}

/** The absolute path, or null unless it lands inside data/bills/. The separator stops data/bills-other/ passing. */
export function billFile(pdfPath: string | null, root: string = REPO_ROOT): string | null {
  if (!pdfPath) return null;
  const file = resolve(root, pdfPath);
  return file.startsWith(resolve(root, "data/bills") + sep) ? file : null;
}

/** Null for a path outside the bills folder or a file not on disk. Any other read error is a real failure and throws. */
export async function readBillPdf(pdfPath: string | null, root: string = REPO_ROOT) {
  const file = billFile(pdfPath, root);
  if (!file) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
