import { db } from "@bill-fighter/db/client";
import { currentSession } from "../../../lib/session.ts";
import { liveSnapshot } from "../../../lib/snapshot.ts";

/** Only the signed-in customer's audit. proxy.ts already refuses a request with no session; this is the second check. */
export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Log in first" }, { status: 401 });
  return Response.json(await liveSnapshot(db, session.cid));
}
