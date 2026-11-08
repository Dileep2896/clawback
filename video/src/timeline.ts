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
};

export const FPS = 30;
export const MAX_FRAMES = 3600; // the 2:00 hard cap
export const BREATH_SEC = 0.5;

export const sceneFrames = (s: Scene) => Math.round(((s.voSec ?? s.sec ?? 0) + (s.voSec ? BREATH_SEC : 0)) * FPS);

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
