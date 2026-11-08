import { describe, expect, it } from "vitest";
import { liveCallProblem, type TakeCall } from "./live-check.ts";

const live: TakeCall = { mode: "live", endedAt: "2026-11-07T19:30:00Z", recordingUrl: "https://r/x.wav", transcriptJson: [{ kind: "speech" }] };

describe("liveCallProblem", () => {
  it("accepts a finished live call", () => expect(liveCallProblem([live])).toBeUndefined());
  it("rejects a take with no call", () => expect(liveCallProblem([])).toMatch(/no call/));
  it("rejects a sim fallback next to the failed live call", () =>
    expect(liveCallProblem([{ ...live, recordingUrl: null }, { ...live, mode: "sim" }])).toBeTruthy());
  it("rejects a sim call", () => expect(liveCallProblem([{ ...live, mode: "sim" }])).toMatch(/sim call/));
  it("rejects a fallback row", () => expect(liveCallProblem([{ ...live, transcriptJson: [{ kind: "fallback" }] }])).toMatch(/fell back/));
  it("rejects an unfinished call", () => expect(liveCallProblem([{ ...live, endedAt: null }])).toMatch(/never ended/));
});
