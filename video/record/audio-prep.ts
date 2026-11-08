// Cleaned voice and a generated background pad, both local and free (ffmpeg only; nothing downloaded, nothing licensed).
// pnpm exec tsx video/record/audio-prep.ts   (from the repo root, after the clips are copied to video/public/vo/)
// Writes video/public/vo/clean/V*.wav (the edit plays these) and video/public/vo/bed.wav. Never touches the originals.
//
// Voice: the gap air in these clips sits at 80-300 Hz (room/wind rumble), with almost nothing above 2 kHz. So:
// high-pass 80 Hz, afftdn with a noise profile sampled from the clip's own longest gap (its floor measured there),
// a soft gate keyed on the voice band (-20 dB, slow release) so air between phrases stays down, then gentle 2:1 compression. No de-esser:
// the denoise leaves the 4-10 kHz band unchanged (measured), so S's are not made harsher.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FPS, layout, type Scene } from "../src/timeline.ts";

const VO = "video/public/vo";
const CLEAN = join(VO, "clean");
const WORDS = JSON.parse(readFileSync("video/src/vo-words.json", "utf8")) as Record<string, { start: number; end: number }[]>;
mkdirSync(CLEAN, { recursive: true });

const rms = (file: string, ss: number, t: number) => {
  const err = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(ss), "-t", String(t), "-i", file, "-af", "highpass=f=80,astats=measure_overall=RMS_level:measure_perchannel=none", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  return Number(/RMS level dB: (-?[\d.]+)/.exec(err)?.[1] ?? -60);
};

for (const clip of readdirSync(VO).filter((f) => /^V\d+\.m4a$/.test(f)).sort()) {
  const src = join(VO, clip);
  const log = spawnSync("ffmpeg", ["-i", src, "-af", "highpass=f=80,silencedetect=noise=-45dB:d=0.2", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const gaps = [...log.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({ end: Number(m[1]), dur: Number(m[2]) }));
  const gap = gaps.sort((a, b) => b.dur - a.dur)[0];
  if (!gap) throw new Error(`${clip}: no gap of 0.2 s to take a noise profile from`);
  const [from, to] = [gap.end - gap.dur + 0.03, gap.end - 0.03]; // keep clear of the word edges
  const floor = Math.max(-80, Math.min(-20, Math.round(rms(src, from, to - from))));
  // The gate listens to the voice band only (300 Hz-3 kHz), so a gust of wind can't open it and it doesn't chatter;
  // it opens at -45 dB there and holds 300 ms, so quiet word tails stay, and gaps fall 20 dB.
  const graph = [
    `[0]highpass=f=80:poles=2,asendcmd=c='${from.toFixed(2)} afftdn sn start; ${to.toFixed(2)} afftdn sn stop',afftdn=nr=15:nf=${floor}:rf=-80,asplit[v][k]`,
    "[k]highpass=f=300,lowpass=f=3000[key]",
    "[v][key]sidechaingate=threshold=0.0056:range=0.1:ratio=4:attack=5:release=300,acompressor=threshold=0.1:ratio=2:attack=20:release=250,",
  ].join(";");
  // Before the first word and after the last, breath and gusts still reach the voice band: fade them down 26 dB
  // with 0.12 s ramps around the voice's own start and end (from vo-words.json).
  const said = WORDS[clip];
  if (!said?.length) throw new Error(`${clip}: no word timings; run vo-words.ts first`);
  const [a, b] = [said[0]!.start - 0.15, said.at(-1)!.end + 0.3];
  const fade = `volume='0.05+0.95*clip((t-${(a - 0.12).toFixed(2)})/0.12,0,1)*clip((${(b + 0.12).toFixed(2)}-t)/0.12,0,1)':eval=frame`;
  const out = join(CLEAN, clip.replace(".m4a", ".wav"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-filter_complex", graph + fade, "-c:a", "pcm_s24le", out]);
  console.info(`${clip}: profile ${from.toFixed(2)}-${to.toFixed(2)} s, floor ${floor} dB, gap ${rms(src, from, to - from).toFixed(1)} → ${rms(out, from, to - from).toFixed(1)} dB`);
}

// The bed: a slow, warm chord pad, no beat. Four chords, 8 s each, cross-faded, looped to the edit's length.
// Each note is a few soft partials, two voices detuned for width; low-passed and given a little room.
const scenes = (JSON.parse(readFileSync("video/public/scenes.json", "utf8")) as { scenes: Scene[] }).scenes;
const { total } = layout(scenes);
const SR = 48000;
const seconds = total / FPS + 1;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
// Cmaj9, Am9, Fmaj9, G6sus: warm, unresolved, calm.
const CHORDS = [
  [48, 55, 64, 67, 71, 74],
  [45, 52, 60, 64, 67, 71],
  [41, 48, 57, 60, 64, 67],
  [43, 50, 57, 60, 62, 64],
];
const CHORD_SEC = 8;
const n = Math.round(seconds * SR);
const pcm = new Float32Array(n);
const L = CHORDS.length;
for (let i = 0; i < n; i++) {
  const t = i / SR;
  const pos = t / CHORD_SEC;
  let v = 0;
  for (let k = 0; k < L; k++) {
    // Raised-cosine weight per chord: each swells in and out over a whole chord length, so the pad never pulses.
    const d = ((((pos - k + L / 2) % L) + L) % L) - L / 2;
    const w = Math.abs(d) < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * d) : 0;
    if (!w) continue;
    for (const m of CHORDS[k]!) {
      const f = hz(m);
      const lfo = 1 + 0.15 * Math.sin(2 * Math.PI * 0.07 * t + m); // slow breathing per note
      for (const det of [-0.004, 0.004]) {
        const ph = 2 * Math.PI * f * (1 + det) * t;
        v += w * lfo * (Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph)) * (m < 50 ? 0.7 : 0.4);
      }
    }
  }
  pcm[i] = v;
}
const peak = pcm.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
const raw = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) raw.writeFloatLE((pcm[i]! / peak) * 0.5, i * 4);
const rawPath = join(VO, "bed.f32");
writeFileSync(rawPath, raw);
// Low-pass for warmth, a soft early-reflection room, then levelled to -20 LUFS (about the voice's own level);
// the edit sets how far under the voice it sits.
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", rawPath, "-af",
  "lowpass=f=1800,lowpass=f=2400,aecho=0.8:0.6:60|113|181:0.3|0.22|0.15,loudnorm=I=-20:TP=-6:LRA=7", "-ar", String(SR), "-c:a", "pcm_s16le", join(VO, "bed.wav")]);
console.info(`bed.wav: ${seconds.toFixed(1)} s`);
