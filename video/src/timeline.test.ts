import { describe, expect, it } from "vitest";
import { clicksIn, layout, type Scene, sceneFrameOf, sceneFrames, stamp } from "./timeline.ts";

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
});
