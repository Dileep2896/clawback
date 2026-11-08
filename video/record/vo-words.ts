// Word timings for the voiceover clips, from a local whisper.cpp (free, no network). The edit starts each highlight on its word.
// pnpm exec tsx video/record/vo-words.ts   (from the repo root; needs whisper-cli, ffmpeg and video/out/models/ggml-small.en.bin)
// Writes video/src/vo-words.json: { "V4.m4a": [{ "text": "collector", "start": 0.68, "end": 1.52 }, ...] }, seconds from the clip's start.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VO = "video/public/vo";
const WORK = "video/out/vo-wav";
const MODEL = "video/out/models/ggml-small.en.bin";
// Whisper mishears a few words; the script (docs/plan/voiceover.md) says these. Keyed "clip:heard".
const FIX: Record<string, string> = {
  "V2.m4a:agent": "agents",
  "V2.m4a:bill": "bills",
  "V4.m4a:ears": "years",
  "V4.m4a:bells": "bills",
  "V4.m4a:built": "billed",
  "V7.m4a:claims": "claim",
  "V8.m4a:off": "of",
};

type Whisper = { transcription: { text: string; offsets: { from: number; to: number } }[] };
mkdirSync(WORK, { recursive: true });
const out: Record<string, { text: string; start: number; end: number }[]> = {};
for (const clip of readdirSync(VO).filter((f) => /^V\d+\.m4a$/.test(f)).sort()) {
  const wav = join(WORK, clip.replace(".m4a", ".wav"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(VO, clip), "-ar", "16000", "-ac", "1", wav]);
  execFileSync("whisper-cli", ["-m", MODEL, "-f", wav, "-ml", "1", "-sow", "-oj", "-np", "-of", wav.replace(".wav", "")], { stdio: "ignore" });
  const words = (JSON.parse(readFileSync(wav.replace(".wav", ".json"), "utf8")) as Whisper).transcription
    .map((s) => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
    .filter((w) => w.text)
    .map((w) => ({ ...w, text: FIX[`${clip}:${w.text.replace(/[.,]$/, "").toLowerCase()}`] ?? w.text }));
  // Whisper pins the first word to 0; the voice starts when the leading silence ends.
  const silence = spawnSync("ffmpeg", ["-i", wav, "-af", "silencedetect=noise=-35dB:d=0.1", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const onset = Number(/silence_start: 0(?:\.0+)?\s[\s\S]*?silence_end: ([\d.]+)/.exec(silence)?.[1] ?? 0);
  if (words[0] && onset < words[0].end) words[0].start = Math.max(words[0].start, onset);
  out[clip] = words.map((w) => ({ text: w.text, start: Number(w.start.toFixed(2)), end: Number(w.end.toFixed(2)) }));
  console.info(`${clip}: ${words.length} words, voice from ${onset.toFixed(2)} s`);
}
writeFileSync("video/src/vo-words.json", `${JSON.stringify(out, null, 1)}\n`);
