// Pure timing for the edit: scene lengths from the voiceover clips, and footage time (events.json ms) to scene frames.
export type Box = { x: number; y: number; w: number; h: number };
export type Ev = { t: number; kind: string; label?: string; box?: Box };
export type Scene = {
  id: string;
  title: string;
  /** Voiceover clip in public/vo/ and its measured length; the scene lasts that long plus a breath. */
  vo?: string;
  voSec?: number;
  /** Length when there is no voiceover (the call). */
  sec?: number;
  card?: "title" | "close";
  /** Footage starts at this event plus offsetSec, at this rate. A rate above 1 always shows a speed label. */
  footage?: { from: string; offsetSec?: number; rate?: number };
  zoom?: { at: string; scale?: number; offsetSec?: number };
  callout?: string;
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

export const footageStartMs = (s: Scene, events: Ev[]) => (s.footage ? eventAt(events, s.footage.from).t + (s.footage.offsetSec ?? 0) * 1000 : 0);

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
export function clicksIn(s: Scene, events: Ev[], kinds: string[]) {
  if (!s.footage) return [];
  const start = footageStartMs(s, events);
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
