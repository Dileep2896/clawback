import type { Snapshot } from "./snapshot.ts";

/** What scripts/replay.ts writes on a replayed run. Its only writer, so this is not parsed. */
export type ReplayInfo = { recordedAt: string; speed: number; startedAt: string; sandbox?: boolean };

/** What lib/sandbox.ts writes on a judge's replay: startedAt moves at the judge's approval, so the clock carries on from their tap. */
export type SandboxState = ReplayInfo & { sandbox: true; cursor: number; approvedAt: string | null };

export const isSandboxReplay = (replay: unknown): replay is SandboxState => (replay as { sandbox?: unknown } | null)?.sandbox === true;

/** Every row of a judge's replay has their customer id as its id prefix. */
export const sandboxId = (customerId: string, id: string) => `${customerId}:${id}`;

export const SANDBOX_LABEL = "Sandbox: a recorded audit replayed for you";

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

// Above this the words cannot be followed, and a backlog would keep talking after the call ended on screen.
const FASTEST_SPEECH = 2;

export const replayOf = (run: Snapshot["run"] | undefined) => (run?.replay ?? null) as ReplayInfo | null;

export const replayLabel = ({ recordedAt, speed, sandbox }: ReplayInfo) =>
  `${sandbox ? SANDBOX_LABEL : "REPLAY"} · recorded ${when.format(new Date(recordedAt))} · ${speed === 1 ? "real speed" : `playing at ${speed}× speed`} · times shown are as recorded`;

/** The moment of the recording now on screen. The timer uses it, so it ticks at the replay's speed and ends on the true length of the call. */
export const recordedNow = ({ recordedAt, speed, startedAt }: ReplayInfo, now: number) =>
  new Date(recordedAt).getTime() + (now - new Date(startedAt).getTime()) * speed;

/** The speech rate for this speed, or null when it plays silent. */
export const speechRate = (replay: ReplayInfo | null) => {
  if (!replay) return 1;
  return replay.speed <= FASTEST_SPEECH ? replay.speed : null;
};
