// Pure timing for the edit: scene lengths from the voiceover clips, and footage time (events.json ms) to scene frames.
export type Box = { x: number; y: number; w: number; h: number };
/** A logged step; `boxes` when one spoken thing is several elements on screen (the seven cancelled lines). */
export type Ev = { t: number; kind: string; label?: string; box?: Box; boxes?: Box[] };
export type Word = { text: string; start: number; end: number };
/** A box on what the voice names: in LEAD_SEC before `say`, held to the end of `to` (else of `say`). `count` adds the count-up. */
export type Highlight = { say: string; to?: string; box: string; count?: boolean };
export type Scene = {
  id: string;
  title: string;
  /** Voiceover clip in public/vo/ and its measured length; the scene lasts that long plus a breath. */
  vo?: string;
  voSec?: number;
  /** Length when there is no voiceover (the call). */
  sec?: number;
  card?: "title" | "close";
  /** Footage starts at this event plus offsetSec, at this rate. A rate above 1 always shows a speed label.
   * `atWord`: the event plays as the voice says this word (the Approve click on "tap"). */
  footage?: { from: string; offsetSec?: number; rate?: number; atWord?: string };
  highlights?: Highlight[];
  zoom?: { at: string; scale?: number; offsetSec?: number };
  callAudio?: { fromSec: number };
  label?: string;
  marker?: string;
  /** The "we also email" motion note, in at this second of the scene. */
  emailCardAtSec?: number;
  /** Seconds the scene holds after its voice, the footage frozen on its last frame (for a card to be read). */
  holdSec?: number;
  cards?: CardCue[];
};
/** A motion card: in as the voice says `from` (or just after it says `after`); `step` brings in its second line. Out at the scene's end. */
export type CardCue = { kind: "market" | "model" | "naive"; from?: string; after?: string; step?: string };

export const FPS = 30;
export const MAX_FRAMES = 3900; // 2:10: the orchestrator let the edit pass 2:00 for the market and business-model cards (2026-11-08)
export const BREATH_SEC = 0.5;

/** The frames the voice (plus its breath) takes; the scene may hold on after it. */
export const voiceFrames = (s: Scene) => Math.round(((s.voSec ?? s.sec ?? 0) + (s.voSec ? BREATH_SEC : 0)) * FPS);
export const sceneFrames = (s: Scene) => voiceFrames(s) + Math.round((s.holdSec ?? 0) * FPS);

export function eventAt(events: Ev[], kind: string): Ev {
  const ev = events.find((e) => e.kind === kind);
  if (!ev) throw new Error(`events.json has no "${kind}" event`);
  return ev;
}

export const boxesOf = (e: Ev): Box[] => e.boxes ?? (e.box ? [e.box] : []);
/** The smallest box round all of them: where the camera looks for a spoken thing that is several elements. */
export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

export const LEAD_SEC = 0.2; // a box shows this long before its word

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9']/g, "");

/** Where the voice says `phrase` (its words in a row, punctuation ignored), searching from `fromSec`. */
export function phraseAt(words: Word[], phrase: string, fromSec = 0): { start: number; end: number } {
  const want = phrase.split(/\s+/).map(norm).filter(Boolean);
  for (let i = 0; i + want.length <= words.length; i++) {
    if (words[i]!.start >= fromSec && want.every((w, k) => norm(words[i + k]!.text) === w)) return { start: words[i]!.start, end: words[i + want.length - 1]!.end };
  }
  throw new Error(`The voiceover never says "${phrase}"${fromSec ? ` after ${fromSec} s` : ""}`);
}

export const footageStartMs = (s: Scene, events: Ev[], words: Word[] = []) =>
  s.footage ? eventAt(events, s.footage.from).t - (s.footage.atWord ? phraseAt(words, s.footage.atWord).start * (s.footage.rate ?? 1) * 1000 : 0) + (s.footage.offsetSec ?? 0) * 1000 : 0;

/** A scene's highlights in scene seconds, in order; each searched after the one before, so a repeated word picks the next. */
export function highlightTimes(s: Scene, words: Word[]) {
  let after = 0;
  return (s.highlights ?? []).map((h) => {
    const say = phraseAt(words, h.say, after);
    after = say.start + 0.01; // strictly after, so the same word is not found twice
    const end = h.to ? phraseAt(words, h.to, say.start).end : say.end;
    return { ...h, start: Math.max(0, say.start - LEAD_SEC), end, word: say.start };
  });
}

/** Sync problems: a box whose element was logged after its highlight starts (not yet on screen), or not logged at all. */
export function syncProblems(scenes: Scene[], events: Ev[], words: Record<string, Word[]>) {
  const problems: string[] = [];
  for (const s of scenes) {
    if (!s.highlights) continue;
    const clip = words[s.vo ?? ""] ?? [];
    const start = footageStartMs(s, events, clip);
    const rate = s.footage?.rate ?? 1;
    for (const h of highlightTimes(s, clip)) {
      const ev = events.find((e) => e.kind === h.box);
      if (!ev?.box && !ev?.boxes?.length) problems.push(`${s.id}: "${h.say}" boxes ${h.box}, which the take never logged`);
      else if (ev.t > start + h.start * rate * 1000) problems.push(`${s.id}: "${h.say}" at ${h.start.toFixed(2)} s, but ${h.box} was only on screen ${((ev.t - start) / rate / 1000).toFixed(2)} s into the scene`);
    }
  }
  return problems;
}

/** The scene frame at which footage time tMs plays, given the scene's footage start and rate. */
export const sceneFrameOf = (tMs: number, startMs: number, rate: number) => Math.round(((tMs - startMs) / 1000 / rate) * FPS);

/** Scene start frames and the total, which must stay under the cap. */
export function layout(scenes: Scene[]) {
  let at = 0;
  const starts = scenes.map((s) => {
    const start = at;
    at += sceneFrames(s);
    return start;
  });
  if (at > MAX_FRAMES) throw new Error(`The edit is ${at} frames, over the ${MAX_FRAMES}-frame cap`);
  return { starts, total: at };
}

/** Footage clicks that fall inside a scene, in scene frames, at their box centres. */
export function clicksIn(s: Scene, events: Ev[], kinds: string[], words: Word[] = []) {
  if (!s.footage) return [];
  const start = footageStartMs(s, events, words);
  const rate = s.footage.rate ?? 1;
  return events
    .filter((e) => kinds.includes(e.kind) && e.box)
    .map((e) => ({ frame: sceneFrameOf(e.t, start, rate), x: e.box!.x + e.box!.w / 2, y: e.box!.y + e.box!.h / 2 }))
    .filter((c) => c.frame >= 0 && c.frame < sceneFrames(s));
}

/** m:ss.s for the rough cut's timeline. */
export const stamp = (frame: number) => {
  const tenths = Math.round((frame / FPS) * 10); // round first, so 59.97 s reads 1:00.0, not 0:60.0
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

export const CAPTION_LINE = 42; // characters a caption line holds
export type Cue = { start: number; end: number; lines: string[] };

// A cut just after a comma reads better, so it counts as this many characters shorter; one after a weak word ("the") worse.
const COMMA_BONUS = 6;
const WEAK = /\s(the|a|an|and|or|of|to|in|for|under|over|with)$/i;
const WEAK_PENALTY = 12;

/** Where to cut a run of words in two: the longer half as short as it can be, a comma preferred; `fits` limits the halves. */
function bestCut(parts: string[], fits: (a: string, b: string) => boolean = () => true) {
  let best = -1;
  let bestCost = Infinity;
  for (let k = 1; k < parts.length; k++) {
    const [a, b] = [parts.slice(0, k).join(" "), parts.slice(k).join(" ")];
    if (!fits(a, b)) continue;
    const cost = Math.max(a.length, b.length) - (a.endsWith(",") ? COMMA_BONUS : 0) + (WEAK.test(a) ? WEAK_PENALTY : 0);
    if (cost < bestCost) [best, bestCost] = [k, cost];
  }
  return best;
}

/** Two lines at most, each within CAPTION_LINE when it can be. */
function wrap(text: string): string[] {
  if (text.length <= CAPTION_LINE) return [text];
  const words = text.split(" ");
  const k = bestCut(words, (a, b) => a.length <= CAPTION_LINE && b.length <= CAPTION_LINE);
  const at = k > 0 ? k : bestCut(words);
  return [words.slice(0, at).join(" "), words.slice(at).join(" ")];
}

/**
 * The voiceover as captions: one cue per sentence, a sentence longer than two 42-character lines cut where the halves are
 * most even (a comma preferred). Each cue shows from its first word to the next cue (or 0.6 s after its last word, whichever
 * is first). `say` rewrites a spoken word as the screen shows it (a figure).
 */
export function captionCues(words: Word[], say: Record<string, string> = {}): Cue[] {
  const texts = words.map((w) => {
    const core = w.text.replace(/[.,]$/, "");
    return say[core] ? say[core] + w.text.slice(core.length) : w.text;
  });
  const sentences: number[][] = [[]];
  texts.forEach((text, i) => {
    sentences.at(-1)!.push(i);
    if (/[.!?]$/.test(text) && i < texts.length - 1) sentences.push([]);
  });
  const split = (idx: number[]): number[][] => {
    if (idx.map((i) => texts[i]).join(" ").length <= CAPTION_LINE * 2) return [idx];
    // A comma that leaves both halves within two lines wins; else the most even cut.
    const parts = idx.map((i) => texts[i]!);
    const atComma = bestCut(parts, (x, y) => x.endsWith(",") && x.length <= CAPTION_LINE * 2 && y.length <= CAPTION_LINE * 2);
    const k = atComma > 0 ? atComma : bestCut(parts);
    return [...split(idx.slice(0, k)), ...split(idx.slice(k))];
  };
  const chunks = sentences.filter((s) => s.length).flatMap(split);
  return chunks.map((idx, k) => {
    const next = chunks[k + 1];
    const last = words[idx.at(-1)!]!;
    return {
      start: words[idx[0]!]!.start,
      end: next ? Math.min(last.end + 0.6, words[next[0]!]!.start) : last.end + 0.6,
      lines: wrap(idx.map((i) => texts[i]!).join(" ")),
    };
  });
}

/** A scene's cards in scene seconds: when each comes in and when its second line does. */
export function cardTimes(s: Scene, words: Word[]) {
  return (s.cards ?? []).map((c) => ({
    kind: c.kind,
    start: c.from ? phraseAt(words, c.from).start : c.after ? phraseAt(words, c.after).end + 0.1 : 0,
    step: c.step ? phraseAt(words, c.step).start - 0.3 : undefined,
  }));
}

/** The background pad's gain per frame of the whole edit, in dB: base, 6 dB lower under the voice, 20 dB lower under the
 *  live call (so it stays clear); in over the first 2 s, out over the last 3 s (the close card). It dips a quarter second
 *  before the voice and comes back half a second after, slewing so it never jumps. */
export const BED_DB = { base: -32, voice: -38, call: -52 }; // measured in the final mix: the pad alone sits about 20 dB under speech
export function bedGainDb(scenes: Scene[], words: Record<string, Word[]>) {
  const { starts, total } = layout(scenes);
  const target = new Float32Array(total).fill(BED_DB.base);
  scenes.forEach((s, i) => {
    const at = (sec: number) => starts[i]! + Math.round(sec * FPS);
    if (s.callAudio) target.fill(BED_DB.call, starts[i]!, starts[i]! + sceneFrames(s));
    for (const w of words[s.vo ?? ""] ?? []) for (let f = Math.max(0, at(w.start - 0.25)); f < Math.min(total, at(w.end + 0.5)); f++) target[f] = Math.min(target[f]!, BED_DB.voice);
  });
  const db = new Float32Array(total);
  let cur = target[0]!;
  for (let f = 0; f < total; f++) {
    const t = target[f]!;
    cur = t < cur ? Math.max(t, cur - 1) : Math.min(t, cur + 0.3); // down 30 dB/s, back up 9 dB/s
    // Fades: linear in amplitude, applied as dB.
    const fade = Math.min(1, f / (2 * FPS), (total - 1 - f) / (3 * FPS));
    db[f] = cur + (fade > 0 ? 20 * Math.log10(fade) : -120);
  }
  return db;
}
