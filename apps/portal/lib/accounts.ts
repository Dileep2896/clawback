import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "@bill-fighter/db/client";
import { accounts, locations } from "@bill-fighter/db/schema";
import type { Provider } from "@bill-fighter/shared/fixtures";

export const PAGE_SIZE = 5;

/** Anything that is not a whole page number becomes page 1, and a page past the end becomes the last page. */
export function pageOf(total: number, requested: string | undefined) {
  const wanted = Number(requested);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Number.isInteger(wanted) && wanted >= 1 ? wanted : 1, totalPages);
  return { page, totalPages, offset: (page - 1) * PAGE_SIZE };
}

/** Every query filters on provider: this is what keeps one login out of another provider's accounts. */
export async function listAccounts(db: Db, provider: Provider, options: { location?: string; page?: string } = {}) {
  const ownAccounts = eq(accounts.provider, provider);
  const where = options.location ? and(ownAccounts, eq(accounts.locationId, options.location)) : ownAccounts;

  const [counted] = await db.select({ total: count() }).from(accounts).where(where);
  const total = counted?.total ?? 0;
  const { page, totalPages, offset } = pageOf(total, options.page);

  const rows = await db
    .select({
      id: accounts.id,
      accountNumber: accounts.accountNumber,
      serviceType: accounts.serviceType,
      rateSchedule: accounts.rateSchedule,
      locationName: locations.name,
      address: locations.address,
    })
    .from(accounts)
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(where)
    .orderBy(asc(locations.name), asc(accounts.id))
    .limit(PAGE_SIZE)
    .offset(offset);

  const locationOptions = await db
    .selectDistinct({ id: locations.id, name: locations.name })
    .from(accounts)
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(ownAccounts)
    .orderBy(asc(locations.name));

  return { rows, total, page, totalPages, locations: locationOptions };
}
