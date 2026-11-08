// A live take only counts if every call on it was a real, finished call: the negotiator falls back to a sim call
// (mode "sim", a "fallback" transcript row) when a live one fails, and that run can still end in success with the same figures.
export type TakeCall = { mode: string; endedAt: string | null; recordingUrl: string | null; transcriptJson: unknown };

export function liveCallProblem(calls: TakeCall[]): string | undefined {
  if (!calls.length) return "no call was placed";
  for (const call of calls) {
    if (call.mode !== "live") return `a ${call.mode} call is on the take`;
    if (!call.endedAt) return "a live call never ended";
    if (!call.recordingUrl) return "a live call has no recording";
    const rows = Array.isArray(call.transcriptJson) ? (call.transcriptJson as { kind?: string }[]) : [];
    if (rows.some((row) => row.kind === "fallback")) return "a call fell back to simulation";
  }
}
