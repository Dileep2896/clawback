import { actions, calls } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { expect, it } from "vitest";
import { appendRow, closeCall, openCall, transcriptRow, type TranscriptRow } from "./transcript.ts";

it("opens with the disclosure and keeps every row under concurrent appends", () =>
  withTestDb("voice_transcript", async (db) => {
    await db.insert(actions).values({ id: "a", kind: "call", status: "approved" });
    const { id } = await openCall(db, { actionId: "a", toNumber: "+15550000000" });
    await Promise.all(Array.from({ length: 10 }, (_, i) => appendRow(db, id, transcriptRow("provider", "speech", `line ${i}`))));
    await closeCall(db, id);

    const [call] = await db.select().from(calls);
    const rows = call!.transcriptJson as TranscriptRow[];
    expect(call).toMatchObject({ mode: "sim", toNumber: "+15550000000" });
    expect(call!.endedAt).toBeInstanceOf(Date);
    expect(rows[0]!.content).toBe(DISCLOSURE_LINE);
    expect(rows).toHaveLength(11);
    expect(new Set(rows.map((r) => r.content)).size).toBe(11);
  }));
