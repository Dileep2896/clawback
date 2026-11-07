import { asc, eq } from "drizzle-orm";
import type { Db } from "@bill-fighter/db/client";
import { accounts, locations, phoneLines } from "@bill-fighter/db/schema";
import type { Provider } from "@bill-fighter/shared/fixtures";

export function listLines(db: Db, provider: Provider) {
  return db
    .select({
      id: phoneLines.id,
      number: phoneLines.number,
      label: phoneLines.label,
      purpose: phoneLines.purpose,
      monthlyCents: phoneLines.monthlyCents,
      callsLast12mo: phoneLines.callsLast12mo,
      locationName: locations.name,
    })
    .from(phoneLines)
    .innerJoin(accounts, eq(phoneLines.accountId, accounts.id))
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(eq(accounts.provider, provider))
    .orderBy(asc(locations.name), asc(phoneLines.number));
}
