import type { Db } from "@bill-fighter/db/client";
import { calls } from "@bill-fighter/db/schema";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { eq, sql } from "drizzle-orm";

// `keypress` records that the caller pressed a key, never that a tone was heard. `refused` rows are never spoken.
// A `fallback` row marks a sim call that replaced a failed live one: the dashboard's call panel labels it from this.
// A `status` row says how a live call is going. Retell only gives the transcript once the call ends, so that is all a live call shows until then.
export type TranscriptRow = {
  role: "agent" | "provider" | "system";
  kind: "speech" | "keypress" | "refused" | "fallback" | "status" | "email";
  content: string;
  at: string;
};

export const transcriptRow = (role: TranscriptRow["role"], kind: TranscriptRow["kind"], content: string): TranscriptRow => ({
  role,
  kind,
  content,
  at: new Date().toISOString(),
});

// The disclosure goes in with the row itself, so no call can exist without it first and no model can word it.
export async function openCall(db: Db, call: { actionId: string; toNumber: string }) {
  const first = transcriptRow("agent", "speech", DISCLOSURE_LINE);
  const [row] = await db
    .insert(calls)
    .values({ ...call, mode: "sim", transcriptJson: [first] })
    .returning({ id: calls.id });
  return { id: row!.id, first };
}

// One atomic update per row, so rows are visible as they happen and concurrent appends cannot overwrite each other.
export async function appendRow(db: Db, callId: string, row: TranscriptRow) {
  await db
    .update(calls)
    .set({ transcriptJson: sql`${calls.transcriptJson} || ${JSON.stringify([row])}::jsonb` })
    .where(eq(calls.id, callId));
}

export async function closeCall(db: Db, callId: string) {
  await db.update(calls).set({ endedAt: new Date() }).where(eq(calls.id, callId));
}
