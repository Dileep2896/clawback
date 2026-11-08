import { describe, expect, it } from "vitest";
import { clicksIn, footageStartMs, highlightTimes, layout, phraseAt, type Scene, sceneFrameOf, sceneFrames, stamp, syncProblems, unionBox } from "./timeline.ts";

const events = [
  { t: 1000, kind: "approval" },
  { t: 4000, kind: "approve", box: { x: 100, y: 200, w: 40, h: 20 } },
  { t: 90_000, kind: "approve", box: { x: 0, y: 0, w: 2, h: 2 } },
];

describe("timeline", () => {
  it("lasts the voiceover plus a breath, or the fixed length", () => {
    expect(sceneFrames({ id: "a", title: "", voSec: 7.7 })).toBe(246);
    expect(sceneFrames({ id: "b", title: "", sec: 15 })).toBe(450);
  });

  it("maps footage time to scene frames at a rate", () => {
    expect(sceneFrameOf(4000, 1000, 1)).toBe(90);
    expect(sceneFrameOf(4000, 1000, 2)).toBe(45);
  });

  it("finds the clicks inside a scene at their box centres", () => {
    const s: Scene = { id: "approval", title: "", voSec: 7.7, footage: { from: "approval" } };
    expect(clicksIn(s, events, ["approve"])).toEqual([{ frame: 90, x: 120, y: 210 }]);
  });

  it("refuses an edit over the 2:00 cap", () => {
    expect(layout([{ id: "a", title: "", sec: 60 }, { id: "b", title: "", sec: 59 }]).total).toBe(3570);
    expect(() => layout([{ id: "a", title: "", sec: 121 }])).toThrow(/cap/);
  });

  it("stamps frames as m:ss.s", () => {
    expect(stamp(3555)).toBe("1:58.5");
    expect(stamp(1799)).toBe("1:00.0");
  });

  const words = [
    { text: "The", start: 0.3, end: 0.7 },
    { text: "Auditor", start: 0.7, end: 1.2 },
    { text: "checks,", start: 1.2, end: 1.6 },
    { text: "one", start: 2, end: 2.3 },
    { text: "tap.", start: 2.4, end: 2.8 },
    { text: "The", start: 3, end: 3.2 },
    { text: "Auditor", start: 3.2, end: 3.6 },
  ];

  it("finds a phrase by its words, ignoring case and punctuation, from a given second", () => {
    expect(phraseAt(words, "auditor checks")).toEqual({ start: 0.7, end: 1.6 });
    expect(phraseAt(words, "the auditor", 1)).toEqual({ start: 3, end: 3.6 });
    expect(() => phraseAt(words, "tariff")).toThrow(/never says "tariff"/);
  });

  it("starts each box 0.2 s before its word and holds it to the end of its phrase; a repeated word is the next one", () => {
    const s: Scene = { id: "s", title: "", vo: "V.m4a", highlights: [{ say: "auditor", to: "checks", box: "row" }, { say: "auditor", box: "row2" }] };
    expect(highlightTimes(s, words).map(({ start, end }) => ({ start: Number(start.toFixed(2)), end }))).toEqual([
      { start: 0.5, end: 1.6 },
      { start: 3, end: 3.6 },
    ]);
  });

  it("plays the anchor event as the voice says its word", () => {
    const s: Scene = { id: "s", title: "", footage: { from: "approve", atWord: "tap" } };
    expect(footageStartMs(s, events, words)).toBe(4000 - 2400);
  });

  it("reports a box whose element was not on screen yet, or never logged", () => {
    const s: Scene = { id: "s", title: "", vo: "V.m4a", footage: { from: "approval" }, highlights: [{ say: "checks", box: "missing" }, { say: "one tap", box: "approve" }] };
    const problems = syncProblems([s], events, { "V.m4a": words });
    expect(problems[0]).toMatch(/missing, which the take never logged/);
    expect(problems[1]).toMatch(/"one tap" at 1\.80 s, but approve was only on screen 3\.00 s/);
    expect(syncProblems([{ ...s, highlights: [{ say: "one tap", box: "approve" }], footage: { from: "approval", offsetSec: 2 } }], events, { "V.m4a": words })).toEqual([]);
  });

  it("boxes several elements as one for the camera", () => {
    expect(unionBox([{ x: 10, y: 20, w: 10, h: 10 }, { x: 0, y: 40, w: 5, h: 5 }])).toEqual({ x: 0, y: 20, w: 20, h: 25 });
  });
});
