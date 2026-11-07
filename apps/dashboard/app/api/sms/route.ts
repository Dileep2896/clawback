import { db } from "@bill-fighter/db/client";
import { z } from "zod";
import { receiveSms, respond } from "../../../lib/decisions.ts";

const Body = z.object({ runId: z.string().min(1), body: z.string().trim().min(1).max(1000) });

export async function POST(request: Request) {
  return respond(request, Body, (input) => receiveSms(db, input));
}
