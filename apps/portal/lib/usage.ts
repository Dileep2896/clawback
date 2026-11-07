import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@bill-fighter/db/client";
import { accounts, usageIntervals } from "@bill-fighter/db/schema";
import type { Provider } from "@bill-fighter/shared/fixtures";

/** Null when there are no rows, so another provider's account and an account with no usage look the same. */
export async function usageCsv(db: Db, provider: Provider, accountId: string): Promise<string | null> {
  const rows = await db
    .select({ ts: usageIntervals.ts, kwh: usageIntervals.kwh })
    .from(usageIntervals)
    .innerJoin(accounts, eq(usageIntervals.accountId, accounts.id))
    .where(and(eq(usageIntervals.accountId, accountId), eq(accounts.provider, provider)))
    .orderBy(asc(usageIntervals.ts));
  if (rows.length === 0) return null;
  const lines = rows.map((row) => `${accountId},${row.ts.toISOString()},${row.kwh}`);
  return `account_id,ts,kwh\n${lines.join("\n")}\n`;
}
