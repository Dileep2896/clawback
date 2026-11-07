import { describe, expect, it } from "vitest";
import { advance, CALL, COUNT_END, COUNT_START, FADE_AT, FINISHED, LOOP, markAt, MAX_FRAME, REFUND_CENTS, refundCentsAt, startAt, STEPS, typedAt } from "./timeline.ts";

const marksAt = (t: number) => STEPS.map((step) => markAt(step, t));

describe("landing playback timeline", () => {
  it("plays the agents in the recorded run's order, one at a time, all done before the fade", () => {
    expect(STEPS.map((step) => step.agent)).toEqual(["Collector", "Auditor", "Approver", "Negotiator", "Finance"]);
    STEPS.forEach((step, i) => {
      expect(step.start).toBeLessThan(step.end);
      if (i > 0) expect(step.start).toBeGreaterThanOrEqual(STEPS[i - 1]!.end);
    });
    expect(STEPS.at(-1)!.end).toBeLessThanOrEqual(FINISHED);
    expect(FINISHED).toBeLessThan(FADE_AT);
    expect(FADE_AT).toBeLessThan(LOOP);
  });

  it("lights each row up in turn", () => {
    expect(marksAt(0)).toEqual(["doing", "idle", "idle", "idle", "idle"]);
    expect(marksAt(STEPS[1]!.end)).toEqual(["done", "found", "idle", "idle", "idle"]);
    expect(marksAt(STEPS[3]!.start)).toEqual(["done", "found", "done", "call", "idle"]);
  });

  it("types the call lines while the Negotiator is on the call, one after the other", () => {
    const negotiator = STEPS[3]!;
    for (const line of CALL) {
      expect(line.start).toBeGreaterThanOrEqual(negotiator.start);
      expect(line.end).toBeLessThanOrEqual(negotiator.end);
      expect(typedAt(line.text, line.start, line.start, line.end)).toBe(0);
      expect(typedAt(line.text, line.end, line.start, line.end)).toBe(line.text.length);
    }
    expect(CALL[1]!.start).toBeGreaterThan(CALL[0]!.end);
  });

  it("counts the refund only while Finance works, rising to exactly $12,606.06", () => {
    const finance = STEPS[4]!;
    expect(COUNT_START).toBeGreaterThanOrEqual(finance.start);
    expect(COUNT_END).toBeLessThanOrEqual(finance.end);
    expect(refundCentsAt(COUNT_START - 1)).toBe(0);
    const samples = Array.from({ length: 23 }, (_, i) => refundCentsAt(COUNT_START + i * 100));
    samples.slice(1).forEach((cents, i) => expect(cents).toBeGreaterThanOrEqual(samples[i]!));
    expect(refundCentsAt(COUNT_END)).toBe(REFUND_CENTS);
    expect(refundCentsAt(LOOP - 1)).toBe(REFUND_CENTS);
  });

  it("loops back to the start after the last frame", () => {
    expect(advance(LOOP - 10, 16, true)).toBe(6);
    expect(marksAt(advance(LOOP - 10, 16, true))).toEqual(marksAt(0));
  });

  it("stands still while paused and resumes from the same frame", () => {
    expect(advance(5_000, 16, false)).toBe(5_000);
    expect(advance(advance(5_000, 16, false), 16, true)).toBe(5_016);
  });

  it("never jumps ahead after a long frame, such as a background tab", () => {
    expect(advance(1_000, 60_000, true)).toBe(1_000 + MAX_FRAME);
    expect(advance(1_000, -5, true)).toBe(1_000);
  });

  it("shows the finished run under reduced motion, and starts from zero otherwise", () => {
    expect(marksAt(startAt(true))).toEqual(STEPS.map((step) => step.endMark));
    expect(refundCentsAt(startAt(true))).toBe(REFUND_CENTS);
    for (const line of CALL) expect(typedAt(line.text, startAt(true), line.start, line.end)).toBe(line.text.length);
    expect(startAt(false)).toBe(0);
  });
});
