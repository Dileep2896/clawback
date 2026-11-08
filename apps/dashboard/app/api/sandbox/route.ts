import { db } from "@bill-fighter/db/client";
import { isSandbox } from "@bill-fighter/shared/sandbox";
import { z } from "zod";
import { respond } from "../../../lib/decisions.ts";
import { restartSandbox } from "../../../lib/sandbox.ts";
import { currentSession } from "../../../lib/session.ts";

const Body = z.object({ action: z.literal("restart") });

/** "Watch it again": the signed-in judge's own replay starts over. Only in the sandbox, where the run is a recording. */
export async function POST(request: Request) {
  if (!isSandbox()) return Response.json({ error: "Only the sandbox replays on request" }, { status: 404 });
  const session = await currentSession();
  if (!session) return Response.json({ error: "Log in first" }, { status: 401 });
  return respond(request, Body, async () => ({ runId: await restartSandbox(db, session.cid) }));
}
