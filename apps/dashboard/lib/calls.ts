import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { z } from "zod";
import type { Snapshot } from "./snapshot.ts";

type Call = Snapshot["calls"][number];

// `kind` stays a plain string: voice-live-caller adds `status`, and an unknown kind is left out rather than breaking the panel.
const Row = z.looseObject({ role: z.string(), kind: z.string(), content: z.string() });
export type Row = z.infer<typeof Row>;

const SHOWN_KINDS = ["speech", "keypress", "refused"];
// The live engine's own words, and the only marker a failed live row has.
const LIVE_FAILED = "Live call failed";

// Fallback and failure rows carry the provider's raw error text, and a Retell id must never reach the screen.
const withoutRetellId = (text: string | undefined) => text?.replace(/call_\w+/g, "the call") ?? null;

const rowsOf = (call: Call): Row[] => {
  const parsed = z.array(Row).safeParse(call.transcriptJson);
  return parsed.success ? parsed.data : [];
};

/** One call per action, the newest. The list is ordered by start time, and a fallback sim row starts after its live attempt ended. */
export const currentCalls = (calls: Call[]): Call[] => [...new Map(calls.map((call) => [call.actionId, call])).values()];

export type CallView = {
  state: "failed" | "in-progress" | "transcript";
  /** Why this sim call replaced a live one, for the on-screen label. */
  fallback: string | null;
  /** Why the live call failed, when no sim call replaced it. */
  failure: string | null;
  rows: Row[];
};

export function viewOf(call: Call): CallView {
  const all = rowsOf(call);
  const fallback = withoutRetellId(all.find((row) => row.kind === "fallback")?.content);
  const failure = withoutRetellId(all.findLast((row) => row.kind === "status" && row.content.startsWith(LIVE_FAILED))?.content);
  // A failed attempt may hold a partial transcript. It never reaches the screen.
  if (failure) return { state: "failed", fallback, failure, rows: [] };
  // The provider only gives the transcript once the call ends.
  if (call.mode === "live" && !call.endedAt) return { state: "in-progress", fallback, failure, rows: [] };
  return { state: "transcript", fallback, failure, rows: all.filter((row) => SHOWN_KINDS.includes(row.kind)) };
}

export const isDisclosure = (row: Row) => row.role === "agent" && row.kind === "speech" && row.content.startsWith(DISCLOSURE_LINE);

/**
 * The rows to speak now, and it notes them in `said`, by call id. Only a sim call is spoken: a live transcript arrives
 * whole once the call has ended, and reading it out would pass it off as happening now. On the first look, rows already
 * there count as said, so a page refresh does not read the call again. A call that appears later starts at its first
 * row, which is the disclosure.
 */
export function nextToSpeak(calls: Call[], said: Map<string, number>, firstLook: boolean): Row[] {
  return calls.flatMap((call) => {
    if (call.mode !== "sim") return [];
    const lines = viewOf(call).rows.filter((row) => row.kind === "speech" && row.role !== "system");
    const from = said.get(call.id) ?? (firstLook ? lines.length : 0);
    said.set(call.id, lines.length);
    return lines.slice(from);
  });
}

export function duration(start: string, end: string | number) {
  const seconds = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
