import { redirect } from "next/navigation";
import { db } from "@bill-fighter/db/client";
import { listAccounts } from "../../lib/accounts.ts";
import { getSession } from "../../lib/session.ts";
import { PortalFrame } from "../portal-frame.tsx";

const one = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const location = one(params.location);
  const list = await listAccounts(db, session.provider, { location, page: one(params.page) });

  const pageHref = (page: number) => {
    const query = new URLSearchParams({ ...(location && { location }), page: String(page) });
    return `/accounts?${query}`;
  };

  return (
    <PortalFrame session={session}>
      <h1 className="text-2xl font-semibold">Your accounts</h1>
      <p data-testid="account-count" className="mt-1 text-muted">
        {list.total} {list.total === 1 ? "account" : "accounts"}, page {list.page} of {list.totalPages}
      </p>

      <form method="get" action="/accounts" className="mt-6 flex flex-wrap items-end gap-3">
        <label className="block">
          Location
          <select id="location" name="location" defaultValue={location ?? ""} className="mt-1 block border border-rule bg-white px-3 py-2">
            <option value="">All locations</option>
            {list.locations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" data-testid="location-apply" className="border border-ink px-4 py-2 font-semibold">
          Show accounts
        </button>
      </form>

      {list.rows.length === 0 ? (
        <p className="mt-6">No accounts at this location. Choose another location to see its accounts.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-6 font-semibold">Account number</th>
                <th scope="col" className="py-2 pr-6 font-semibold">Location</th>
                <th scope="col" className="py-2 pr-6 font-semibold">Service</th>
                <th scope="col" className="py-2 font-semibold">Plan</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.id} data-testid="account-row" data-account-id={row.id} className="border-b border-rule">
                  <td className="py-3 pr-6 font-semibold tabular-nums">{row.accountNumber}</td>
                  <td className="py-3 pr-6">
                    {row.locationName}
                    <span className="block text-sm text-muted">{row.address}</span>
                  </td>
                  <td className="py-3 pr-6 capitalize">{row.serviceType}</td>
                  <td className="py-3">{row.rateSchedule ?? "None listed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.totalPages > 1 && (
        <nav aria-label="Account pages" className="mt-6 flex gap-6">
          {list.page > 1 && (
            <a href={pageHref(list.page - 1)} rel="prev" className="underline">
              Previous page
            </a>
          )}
          {list.page < list.totalPages && (
            <a href={pageHref(list.page + 1)} rel="next" className="underline">
              Next page
            </a>
          )}
        </nav>
      )}
    </PortalFrame>
  );
}
