import type { Snapshot } from "./snapshot.ts";

/** What scripts/replay.ts writes on a replayed run. Its only writer, so this is not parsed. */
export type ReplayInfo = { recordedAt: string; speed: number; startedAt: string; sandbox?: boolean };

/** What lib/sandbox.ts writes on a judge's replay: startedAt moves at the judge's approval, so the clock carries on from their tap. */
/** contact: the judge's choice at the approval. "email" plays data/replay/run-email.jsonl from then on; absent is a call. */
export type SandboxState = ReplayInfo & { sandbox: true; cursor: number; approvedAt: string | null; pausedMs?: number; contact?: "call" | "email" };

export const isSandboxReplay = (replay: unknown): replay is SandboxState => (replay as { sandbox?: unknown } | null)?.sandbox === true;

/** Every row of a judge's replay has their customer id as its id prefix. */
export const sandboxId = (customerId: string, id: string) => `${customerId}:${id}`;

/**
 * Whether the action is the letter Filer drafted in this run (agents filer.ts letterActionId). Findings outlive runs, so a repeat
 * audit's customer has letters from earlier runs too. A judge's copy carries their prefix on every id, so it is moved to the front.
 */
export function isRunLetter(run: { id: string; customerId: string }, action: { id: string; findingId: string | null }) {
  if (!action.findingId) return false;
  const prefix = sandboxId(run.customerId, "");
  const bare = (id: string) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);
  const letter = `letter-${bare(run.id)}-${bare(action.findingId)}`;
  return action.id === letter || action.id === prefix + letter;
}

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

// Above this the words cannot be followed, and a backlog would keep talking after the call ended on screen.
const FASTEST_SPEECH = 2;

export const replayOf = (run: Snapshot["run"] | undefined) => (run?.replay ?? null) as ReplayInfo | null;

/** The full sentence, for the sandbox pill's popover and screen readers. A judge's sandbox runs on their own clock. */
export const replayLabel = ({ recordedAt, speed, sandbox }: ReplayInfo) =>
  `A recorded audit replayed for you, recorded ${when.format(new Date(recordedAt))}, ${speed === 1 ? "at real speed" : `playing at ${speed}× speed`}. ${sandbox ? "Times shown are on your clock." : "Times shown are as recorded."}`;

/** The pill itself: "Sandbox replay · 2×". */
export const replayPill = ({ speed }: ReplayInfo) => (speed === 1 ? "Sandbox replay" : `Sandbox replay · ${speed}×`);

/** The moment of the recording now on screen. The timer uses it, so it ticks at the replay's speed and ends on the true length of the call. */
export const recordedNow = ({ recordedAt, speed, startedAt }: ReplayInfo, now: number) =>
  new Date(recordedAt).getTime() + (now - new Date(startedAt).getTime()) * speed;

/**
 * Seconds the run has taken. A recorded replay keeps its recorded times, so its clock is the recording's; a judge's sandbox
 * rows are rewritten onto the judge's clock (sandbox.ts wallTime), so theirs is the plain clock.
 */
export function runSeconds(run: Pick<NonNullable<Snapshot["run"]>, "startedAt" | "finishedAt" | "replay">, now: number) {
  const replay = replayOf(run as Snapshot["run"]);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : replay && !isSandboxReplay(replay) ? recordedNow(replay, now) : now;
  return Math.max(0, Math.round((end - Date.parse(run.startedAt)) / 1000));
}

/** The speech rate for this speed, or null when it plays silent. */
export const speechRate = (replay: ReplayInfo | null) => {
  if (!replay) return 1;
  return replay.speed <= FASTEST_SPEECH ? replay.speed : null;
};
