// The landing hero's playback, as pure functions of one clock (ms into the loop). live-run.tsx renders it.
// A shortened playback of the recorded demo run (data/replay/run.jsonl, 4 min 28 s), in the run's own order;
// the landing-live lane notes list the run row behind every word and number.

export const LOOP = 18_000;
export const FADE_AT = 17_300;
/** Every step done: the frame shown under prefers-reduced-motion, and where the progress line is full. */
export const FINISHED = 15_000;
/** A frame longer than this (a background tab, a stall) counts as this much, so the playback never jumps ahead. */
export const MAX_FRAME = 100;

export type Mark = "idle" | "doing" | "done" | "found" | "call";

export type Step = { agent: string; text: string; start: number; end: number; endMark: Mark; doingMark?: Mark };

export const STEPS: Step[] = [
  { agent: "Collector", text: "downloading bills and usage", start: 0, end: 2_400, endMark: "done" },
  { agent: "Auditor", text: "Fremont meter billed 2x", start: 2_600, end: 4_400, endMark: "found" },
  { agent: "Approver", text: "Linda Park approved by SMS", start: 5_600, end: 6_800, endMark: "done" },
  { agent: "Negotiator", text: "calling BayTel", start: 7_000, end: 11_600, endMark: "done", doingMark: "call" },
  { agent: "Finance", text: "refund claimed", start: 11_800, end: 14_400, endMark: "done" },
];

// The BayTel call transcript, lines 9 and 10, typed out while the Negotiator is on the call.
export const CALL = [
  { who: "Clawback", text: "Please cancel phone line (415) 555-0102 on account BT-7001.", start: 7_500, end: 9_700 },
  { who: "BayTel", text: "Yes, that is cancelled.", start: 10_100, end: 10_900 },
];

export const REFUND_CENTS = 1_260_606;
export const COUNT_START = 12_000;
export const COUNT_END = 14_200;

export const progress = (t: number, start: number, end: number) => Math.min(1, Math.max(0, (t - start) / (end - start)));

export function markAt(step: Step, t: number): Mark {
  if (t < step.start) return "idle";
  if (t < step.end) return step.doingMark ?? "doing";
  return step.endMark;
}

/** How many characters of a line show at t. */
export const typedAt = (text: string, t: number, start: number, end: number) => Math.round(text.length * progress(t, start, end));

/** The refund counter at t: rolls up with an ease-out from COUNT_START, lands exactly on the refund. Display only. */
export const refundCentsAt = (t: number) => Math.round(REFUND_CENTS * (1 - (1 - progress(t, COUNT_START, COUNT_END)) ** 3));

/** The clock after one animation frame of dt ms. It stands still while paused or off-screen, and wraps at the loop's end. */
export const advance = (elapsed: number, dt: number, running: boolean) => (running ? (elapsed + Math.min(Math.max(dt, 0), MAX_FRAME)) % LOOP : elapsed);

/** Where the clock starts: the finished run, still, when the viewer asked for reduced motion. */
export const startAt = (reducedMotion: boolean) => (reducedMotion ? FINISHED : 0);
