import { describe, expect, it } from "vitest";
import { recordedNow, replayLabel, replayOf, speechRate, type ReplayInfo } from "./replay.ts";
import type { Snapshot } from "./snapshot.ts";

const info = (speed: number): ReplayInfo => ({ recordedAt: "2026-11-06T10:00:00.000Z", speed, startedAt: "2026-11-07T20:00:00.000Z" });

describe("replayLabel", () => {
  it("always says replay, and when it was recorded", () => {
    expect(replayLabel(info(1))).toMatch(/^REPLAY · recorded Nov \d+, 2026/);
  });

  it("says real speed at 1×, and the speed otherwise", () => {
    expect(replayLabel(info(1))).toContain("real speed");
    expect(replayLabel(info(1.8))).toContain("playing at 1.8× speed");
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
