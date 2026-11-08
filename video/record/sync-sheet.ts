// Proof that the boxes follow the voice: one still per highlight from a rendered cut, captioned with its time, the words
// being spoken and what is boxed, tiled into one PNG. Also prints syncProblems (an element boxed before the take showed it).
// pnpm exec tsx video/record/sync-sheet.ts video/out/rough.mp4 ~/Desktop/clawback-video/sync-sheet-<date>.png   (from the repo root)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Ev, FPS, highlightTimes, layout, phraseAt, type Scene, stamp, syncProblems, type Word } from "../src/timeline.ts";

const [cut, out] = process.argv.slice(2);
if (!cut || !out) throw new Error("Usage: sync-sheet.ts <rendered cut> <sheet.png>");
const scenes = (JSON.parse(readFileSync("video/public/scenes.json", "utf8")) as { scenes: Scene[] }).scenes;
const events = (JSON.parse(readFileSync("video/public/events.json", "utf8")) as { events: Ev[] }).events;
const words = JSON.parse(readFileSync("video/src/vo-words.json", "utf8")) as Record<string, Word[]>;
const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";
const WORK = "video/out/sync-sheet";

const problems = syncProblems(scenes, events, words);
console.info(problems.length ? `Sync problems:\n${problems.join("\n")}` : "Sync: every boxed element was on screen before its word.");

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const { starts } = layout(scenes);
let n = 0;
scenes.forEach((s, i) => {
  const clip = words[s.vo ?? ""] ?? [];
  for (const h of highlightTimes(s, clip)) {
    // Mid-word: the box is fully in by the word's start (its 0.2 s lead), so this shows it as the word is heard.
    const frame = starts[i]! + Math.round((h.word + 0.15) * FPS);
    const end = h.to ? phraseAt(clip, h.to, h.word).end : h.end;
    const spoken = clip.filter((w) => w.start >= h.word - 0.01 && w.start < end).map((w) => w.text).join(" ");
    const caption = join(WORK, `c${n}.txt`);
    writeFileSync(caption, `${stamp(frame)}  ${s.id}\n"${spoken}"  >  ${h.box}`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(frame / FPS), "-i", cut, "-frames:v", "1", "-vf",
      `scale=800:-1,pad=800:450+86:0:0:#0b0f14,drawtext=fontfile=${FONT}:expansion=none:textfile=${caption}:x=14:y=462:fontsize=22:fontcolor=#e8edf2:line_spacing=8`,
      join(WORK, `s${String(n).padStart(2, "0")}.png`)]);
    n++;
  }
});
const cols = 3;
execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", join(WORK, "s%02d.png"), "-vf", `tile=${cols}x${Math.ceil(n / cols)}:padding=8:color=#263040`, "-frames:v", "1", out]);
console.info(`${n} stills → ${out}`);
if (problems.length) process.exitCode = 1;
