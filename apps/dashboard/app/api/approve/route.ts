import { db } from "@bill-fighter/db/client";
import { z } from "zod";
import { approveRun, respond } from "../../../lib/decisions.ts";

const Body = z.object({ runId: z.string().min(1) });

export async function POST(request: Request) {
  return respond(request, Body, ({ runId }) => approveRun(db, runId));
}
