import { db } from "@bill-fighter/db/client";
import { z } from "zod";
import { approveRun, respond } from "../../../lib/decisions.ts";
import { currentSession } from "../../../lib/session.ts";

const Body = z.object({ runId: z.string().min(1), contact: z.enum(["call", "email"]).default("call") });

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Log in first" }, { status: 401 });
  return respond(request, Body, ({ runId, contact }) => approveRun(db, runId, session.cid, session.uid, contact));
}
