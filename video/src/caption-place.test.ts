import { describe, expect, it } from "vitest";
import { bandBox, type Box, CAPTION, type CaptionPlace, overlaps, placeCaption } from "./timeline.ts";

const one = ["It found the Fremont store paying for double."];
const two = ["Since the meter was changed in September", "2025, the Fremont store has paid double."];
const clearOf = (lines: string[], place: CaptionPlace, obstacles: Box[]) => !obstacles.some((o) => overlaps(bandBox(lines, place), o));

describe("placeCaption", () => {
  it("sits bottom centre when nothing is in the way", () => {
    expect(placeCaption(one, [])).toEqual({ bottom: CAPTION.bottom });
    expect(placeCaption(one, [{ x: 0, y: 0, w: 300, h: 300 }])).toEqual({ bottom: CAPTION.bottom });
  });

  it("goes to the top when a box sits on the bottom band", () => {
    expect(placeCaption(one, [{ x: 800, y: 900, w: 200, h: 40 }])).toEqual({ top: 96 });
  });

  it("scans up past several obstacles to the lowest clear place", () => {
    const obstacles = [
      { x: 800, y: 900, w: 200, h: 40 }, // on the bottom band
      { x: 700, y: 120, w: 400, h: 40 }, // on the top band
      { x: 600, y: 780, w: 500, h: 60 }, // just above the bottom band
    ];
    const place = placeCaption(two, obstacles);
    expect(place).toEqual({ bottom: 318 });
    expect(clearOf(two, place, obstacles)).toBe(true);
    expect(clearOf(two, { bottom: 310 }, obstacles)).toBe(false); // 8 px lower would cover one
  });

  it("stays clear of a highlight for every frame it moves through", () => {
    // The camera zooms in, so one box is sampled sliding down across the screen during the cue.
    const moving = Array.from({ length: 6 }, (_, i) => ({ x: 700, y: 500 + i * 80, w: 500, h: 40 }));
    const place = placeCaption(one, [...moving, { x: 700, y: 110, w: 500, h: 40 }]);
    expect(clearOf(one, place, moving)).toBe(true);
    expect("bottom" in place && bandBox(one, place).y + bandBox(one, place).h).toBeLessThan(500 - 12);
  });

  it("does not cover the Fremont box at 0:46 (top taken, the zoomed box on the bottom band)", () => {
    // The Fremont label (events.json `fremont`, 399x18 at 665,465) zoomed 2x and moving to the lower third, the kWh card at the top.
    const fremont = [0, 1, 2, 3].map((i) => ({ x: 560, y: 860 - i * 30, w: 798, h: 36 }));
    const top = { x: 420, y: 80, w: 1080, h: 140 };
    const place = placeCaption(two, [...fremont, top]);
    expect(place).not.toEqual({ bottom: CAPTION.bottom });
    expect(clearOf(two, place, [...fremont, top])).toBe(true);
  });

  it("falls back to the place covering least when nowhere is clear", () => {
    const strip = { x: 955, y: 0, w: 10, h: 1080 }; // every place touches it, equally
    const low = { x: 0, y: 300, w: 1920, h: 780 }; // covers all but the top
    expect(placeCaption(one, [strip, low])).toEqual({ top: 96 });
  });
});
