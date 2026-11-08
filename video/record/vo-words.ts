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
  // The agents' names, capitalised as in the script and on screen.
  "V4.m4a:collector": "Collector",
  "V4.m4a:auditor": "Auditor",
  "V5.m4a:approver": "Approver",
  "V6.m4a:negotiator": "Negotiator",
  "V7.m4a:filer": "Filer",
  "V7.m4a:claims": "claim",
  "V8.m4a:off": "of",
  "V9.m4a:clawback": "Clawback",
};

type Whisper = { transcription: { text: string; offsets: { from: number; to: number } }[] };
mkdirSync(WORK, { recursive: true });
const out: Record<string, { text: string; start: number; end: number }[]> = {};
// Where the voice starts: the first 50 ms with speech-band (300 Hz-3 kHz) level over -42 dB, so wind rumble before it
// doesn't count.
function onsetSec(wav: string) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", wav, "-af", "highpass=f=300,lowpass=f=3000,asetnsamples=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"], { encoding: "utf8" }).stdout;
  const levels = log.split("\n").filter((l) => l.includes("RMS_level")).map((l) => Number(l.split("=")[1]));
  const first = levels.findIndex((db) => db > -42);
  return Math.max(0, first) * 0.05; // 800 samples at 16 kHz
}
function transcribe(wav: string, fromSec: number) {
  const heard = wav.replace(".wav", `.from${fromSec.toFixed(2)}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", fromSec.toFixed(3), "-i", wav, heard]);
  execFileSync("whisper-cli", ["-m", MODEL, "-f", heard, "-ml", "1", "-sow", "-oj", "-np", "-of", heard.replace(".wav", "")], { stdio: "ignore" });
  return (JSON.parse(readFileSync(heard.replace(".wav", ".json"), "utf8")) as Whisper).transcription
    .map((s) => ({ text: s.text.trim(), start: fromSec + s.offsets.from / 1000, end: fromSec + s.offsets.to / 1000 }))
    .filter((w) => w.text);
}

for (const clip of readdirSync(VO).filter((f) => /^V\d+\.m4a$/.test(f)).sort()) {
  const wav = join(WORK, clip.replace(".m4a", ".wav"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(VO, clip), "-ar", "16000", "-ac", "1", wav]);
  const onset = onsetSec(wav);
  const words = transcribe(wav, 0).map((w) => {
    const core = w.text.replace(/[.,]$/, "");
    const fix = FIX[`${clip}:${core.toLowerCase()}`];
    return fix ? { ...w, text: fix + w.text.slice(core.length) } : w; // keep the word's punctuation
  });
  // Whisper squeezes the opening phrase into a leading pause (V2's "This is" came out 1.2 s early; checked against the
  // speech-band level). A second pass that hears the clip from just before the voice times that phrase right, but drifts
  // later on (V8's "only" a second early), so it re-times only the words up to the first comma or full stop.
  const lead = transcribe(wav, Math.max(0, onset - 0.15));
  const phraseEnd = words.findIndex((w) => /[.,]$/.test(w.text));
  if (lead.length === words.length) for (let i = 0; i <= phraseEnd; i++) Object.assign(words[i]!, { start: lead[i]!.start, end: lead[i]!.end });
  else console.warn(`${clip}: the second pass heard ${lead.length} words, not ${words.length}; opening phrase left as heard`);
  if (words[0] && onset < words[0].end) words[0].start = Math.max(words[0].start, onset);
  out[clip] = words.map((w) => ({ text: w.text, start: Number(w.start.toFixed(2)), end: Number(w.end.toFixed(2)) }));
  console.info(`${clip}: ${words.length} words, voice from ${onset.toFixed(2)} s`);
}
writeFileSync("video/src/vo-words.json", `${JSON.stringify(out, null, 1)}\n`);
