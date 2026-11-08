import { describe, expect, it } from "vitest";
import { isRunLetter, recordedNow, replayLabel, replayOf, replayPill, runSeconds, speechRate, type ReplayInfo } from "./replay.ts";
import type { Snapshot } from "./snapshot.ts";

const info = (speed: number): ReplayInfo => ({ recordedAt: "2026-11-06T10:00:00.000Z", speed, startedAt: "2026-11-07T20:00:00.000Z" });

describe("replayLabel", () => {
  it("always says replay, and when it was recorded", () => {
    expect(replayLabel(info(1))).toMatch(/^A recorded audit replayed for you, recorded Nov \d+, 2026/);
  });

  it("says real speed at 1×, and the speed otherwise", () => {
    expect(replayLabel(info(1))).toContain("at real speed");
    expect(replayLabel(info(1.8))).toContain("playing at 1.8× speed");
  });

  it("puts the speed on the pill only when it is not real speed", () => {
    expect(replayPill(info(2))).toBe("Sandbox replay · 2×");
    expect(replayPill(info(1))).toBe("Sandbox replay");
  });
});

describe("replayOf", () => {
  it("finds the label on a replayed run only", () => {
    expect(replayOf({ replay: info(2) } as Snapshot["run"])).toEqual(info(2));
    expect(replayOf({ replay: null } as Snapshot["run"])).toBeNull();
    expect(replayOf(null)).toBeNull();
    expect(replayOf(undefined)).toBeNull();
  });
});

describe("recordedNow", () => {
  const started = new Date(info(1).startedAt).getTime();
  const recorded = new Date(info(1).recordedAt).getTime();

  it("is the recorded start when playback starts", () => {
    expect(recordedNow(info(4), started)).toBe(recorded);
  });

  it("runs with the wall clock at real speed, and N times as fast at N×", () => {
    expect(recordedNow(info(1), started + 10_000)).toBe(recorded + 10_000);
    expect(recordedNow(info(4), started + 10_000)).toBe(recorded + 40_000);
  });
});

describe("speechRate", () => {
  it("is normal off a replay", () => expect(speechRate(null)).toBe(1));
  it("follows the speed up to 2×", () => {
    expect(speechRate(info(1))).toBe(1);
    expect(speechRate(info(1.8))).toBe(1.8);
    expect(speechRate(info(2))).toBe(2);
  });
  it("is off above 2×", () => expect(speechRate(info(2.5))).toBeNull());
});

describe("runSeconds (review: sandbox elapsed stayed at 0:00)", () => {
  const T0 = "2026-11-08T20:00:00.000Z";
  const at = (iso: string) => Date.parse(iso);
  it("a judge's sandbox run counts on the judge's clock, running and finished", () => {
    const replay = { ...info(4), startedAt: T0, sandbox: true, cursor: 0, approvedAt: null };
    expect(runSeconds({ startedAt: T0, finishedAt: null, replay }, at("2026-11-08T20:01:30.000Z"))).toBe(90);
    expect(runSeconds({ startedAt: T0, finishedAt: "2026-11-08T20:03:00.000Z", replay }, at("2026-11-08T21:00:00.000Z"))).toBe(180);
  });
  it("a recorded replay counts on the recording's clock", () => {
    const replay = info(2);
    expect(runSeconds({ startedAt: replay.recordedAt, finishedAt: null, replay }, at("2026-11-07T20:00:30.000Z"))).toBe(60);
  });
  it("a live run counts on the plain clock", () => {
    expect(runSeconds({ startedAt: T0, finishedAt: null, replay: null }, at("2026-11-08T20:00:05.000Z"))).toBe(5);
  });
});

describe("isRunLetter", () => {
  const action = (id: string, findingId: string | null = "finding-1") => ({ id, findingId });

  it("on a repeat audit, takes only this run's letter for a finding, not an earlier run's", () => {
    const run = { id: "run-2", customerId: "c1" };
    expect(isRunLetter(run, action("letter-run-2-finding-1"))).toBe(true);
    expect(isRunLetter(run, action("letter-run-1-finding-1"))).toBe(false);
    // "run" is a prefix of "run-2": the exact id decides.
    expect(isRunLetter({ id: "run", customerId: "c1" }, action("letter-run-2-finding-1"))).toBe(false);
    expect(isRunLetter(run, action("call-run-2", null))).toBe(false);
  });

  it("matches a judge's sandbox copy, where every id carries their prefix", () => {
    const run = { id: "judge:run-1", customerId: "judge" };
    expect(isRunLetter(run, action("judge:letter-run-1-finding-1", "judge:finding-1"))).toBe(true);
    expect(isRunLetter(run, action("other:letter-run-1-finding-1", "judge:finding-1"))).toBe(false);
  });
});
