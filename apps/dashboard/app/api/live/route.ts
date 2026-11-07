import { db } from "@bill-fighter/db/client";
import { liveSnapshot } from "../../../lib/snapshot.ts";

export async function GET() {
  return Response.json(await liveSnapshot(db));
}
