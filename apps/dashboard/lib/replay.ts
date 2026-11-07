import type { Snapshot } from "./snapshot.ts";

/** What scripts/replay.ts writes on a replayed run. Its only writer, so this is not parsed. */
export type ReplayInfo = { recordedAt: string; speed: number; startedAt: string };

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

// Above this the words cannot be followed, and a backlog would keep talking after the call ended on screen.
const FASTEST_SPEECH = 2;

export const replayOf = (run: Snapshot["run"] | undefined) => (run?.replay ?? null) as ReplayInfo | null;

export const replayLabel = ({ recordedAt, speed }: ReplayInfo) =>
  `REPLAY · recorded ${when.format(new Date(recordedAt))} · ${speed === 1 ? "real speed" : `playing at ${speed}× speed`} · times shown are as recorded`;

/** The moment of the recording now on screen. The timer uses it, so it ticks at the replay's speed and ends on the true length of the call. */
export const recordedNow = ({ recordedAt, speed, startedAt }: ReplayInfo, now: number) =>
  new Date(recordedAt).getTime() + (now - new Date(startedAt).getTime()) * speed;

/** The speech rate for this speed, or null when it plays silent. */
export const speechRate = (replay: ReplayInfo | null) => {
  if (!replay) return 1;
  return replay.speed <= FASTEST_SPEECH ? replay.speed : null;
};
