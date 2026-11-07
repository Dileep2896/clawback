import { redirect } from "next/navigation";
import { db } from "@bill-fighter/db/client";
import { money } from "../../lib/bills.ts";
import { listLines } from "../../lib/lines.ts";
import { getSession } from "../../lib/session.ts";
import { PortalFrame } from "../portal-frame.tsx";

export default async function LinesPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const lines = await listLines(db, session.provider);

  return (
    <PortalFrame session={session}>
      <h1 className="text-2xl font-semibold">Phone lines</h1>
      <p data-testid="line-count" className="mt-1 text-muted">
        {lines.length} {lines.length === 1 ? "line" : "lines"}, with calls over the last 12 months
      </p>

      {lines.length === 0 ? (
        <p className="mt-6">This login has no phone lines.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-6 font-semibold">Location</th>
                <th scope="col" className="py-2 pr-6 font-semibold">Number</th>
                <th scope="col" className="py-2 pr-6 font-semibold">Label</th>
                <th scope="col" className="py-2 pr-6 font-semibold">Purpose</th>
                <th scope="col" className="py-2 pr-6 font-semibold">Monthly</th>
                <th scope="col" className="py-2 font-semibold">Calls, 12 months</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} data-testid="line-row" data-line-id={line.id} className="border-b border-rule">
                  <td className="py-3 pr-6">{line.locationName}</td>
                  <td className="py-3 pr-6 font-semibold tabular-nums">{line.number}</td>
                  <td className="py-3 pr-6">{line.label ?? "None listed"}</td>
                  <td className="py-3 pr-6 capitalize">{line.purpose}</td>
                  <td className="py-3 pr-6 tabular-nums">{money(line.monthlyCents)}</td>
                  <td data-testid="line-calls" className="py-3 tabular-nums">{line.callsLast12mo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalFrame>
  );
}
