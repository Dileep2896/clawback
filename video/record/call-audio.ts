// Fetches the take's call recording and word-timed transcript from Retell for the edit. Read-only GETs, free; places no call.
// pnpm exec tsx --env-file=.env video/record/call-audio.ts <retell call id>
// Writes gitignored video/public/call.wav and video/public/call.transcript.json. The key is read from .env and never printed.
import { writeFileSync } from "node:fs";
import { allowlistFromEnv } from "@bill-fighter/shared/allowlist";
import { retellClient } from "@bill-fighter/voice/live/caller/retell";

const id = process.argv[2];
if (!id?.startsWith("call_")) throw new Error("Pass the Retell call id (call_…), from the webhook log line `Live call <id>: …`");
const key = process.env.RETELL_API_KEY;
if (!key) throw new Error("RETELL_API_KEY is not set");

type Call = {
  recording_url?: string;
  start_timestamp: number;
  end_timestamp: number;
  call_cost?: { combined_cost?: number };
  transcript_object?: { role: string; words: { word: string; start: number; end: number }[] }[];
};
const call = (await retellClient(key, allowlistFromEnv())("GET", `/v2/get-call/${id}`)) as Call;
if (!call.recording_url?.startsWith("https://")) throw new Error("Retell has no recording for this call yet");
if (!call.transcript_object?.length) throw new Error("Retell has no word-timed transcript for this call");
const audio = await fetch(call.recording_url, { signal: AbortSignal.timeout(60_000) });
if (!audio.ok) throw new Error(`Recording download failed: HTTP ${audio.status}`);
writeFileSync("video/public/call.wav", Buffer.from(await audio.arrayBuffer()));
writeFileSync("video/public/call.transcript.json", JSON.stringify(call.transcript_object.map(({ role, words }) => ({ role, words })), null, 2));
const seconds = (call.end_timestamp - call.start_timestamp) / 1000;
console.info(`Call ${id}: ${seconds.toFixed(1)} s, Retell $${((call.call_cost?.combined_cost ?? NaN) / 100).toFixed(4)}. Wrote video/public/call.wav and call.transcript.json.`);
