import { db } from "@bill-fighter/db/client";
import { getSession } from "../../../lib/session.ts";
import { usageCsv } from "../../../lib/usage.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Sign in to download usage.", { status: 401 });

  const { accountId } = await params;
  const csv = await usageCsv(db, session.provider, accountId);
  if (!csv) return new Response("Usage not found.", { status: 404 });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Safe in a header: rows only exist for an account id that is really in the database.
      "Content-Disposition": `attachment; filename="${accountId}-usage.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
