import { notFound, redirect } from "next/navigation";
import { db } from "@bill-fighter/db/client";
import { listBills, money } from "../../lib/bills.ts";
import { getSession } from "../../lib/session.ts";
import { PortalFrame } from "../portal-frame.tsx";

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const { account: accountId } = await searchParams;
  const list = typeof accountId === "string" ? await listBills(db, session.provider, accountId) : null;
  if (!list) notFound();

  return (
    <PortalFrame session={session}>
      <h1 className="text-2xl font-semibold">Bills for account {list.account.accountNumber}</h1>
      <p data-testid="bill-count" className="mt-1 text-muted">
        {list.account.locationName}, {list.rows.length} {list.rows.length === 1 ? "bill" : "bills"}
      </p>

      {list.rows.length === 0 ? (
        <p className="mt-6">No bills on this account yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-6 font-semibold">Service period</th>
                <th scope="col" className="py-2 pr-6 font-semibold">Total</th>
                <th scope="col" className="py-2 font-semibold">Download</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((bill) => (
                <tr key={bill.id} data-testid="bill-row" data-bill-id={bill.id} className="border-b border-rule">
                  <td className="py-3 pr-6 tabular-nums">
                    {bill.periodStart} to {bill.periodEnd}
                  </td>
                  <td className="py-3 pr-6 tabular-nums">{money(bill.totalCents)}</td>
                  <td className="py-3">
                    <a href={`/bills/${encodeURIComponent(bill.id)}/pdf`} data-testid="bill-pdf" className="underline">
                      PDF<span className="sr-only"> for {bill.periodStart} to {bill.periodEnd}</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalFrame>
  );
}
