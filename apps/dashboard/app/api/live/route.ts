import { db } from "@bill-fighter/db/client";
import { currentSession } from "../../../lib/session.ts";
import { advanceSandbox } from "../../../lib/sandbox.ts";
import { liveSnapshot } from "../../../lib/snapshot.ts";
import { isSandbox } from "@bill-fighter/shared/sandbox";

/** Only the signed-in customer's audit. proxy.ts already refuses a request with no session; this is the second check. */
export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Log in first" }, { status: 401 });
  // The sandbox has no agents: each poll writes the judge's recorded events that are due by now.
  if (isSandbox()) await advanceSandbox(db, session.cid);
  return Response.json(await liveSnapshot(db, session.cid));
}
