import { describe, expect, it } from "vitest";
import { eligibleSchedules, sustainedKw } from "./eligibility.ts";

describe("sustainedKw", () => {
  const offered = (months: number[]) => eligibleSchedules(sustainedKw(months));

  it("keeps B-6 after a lone spike, or three high months that are not consecutive", () => {
    expect(offered([40, 40, 80, 40, 40, 40])).toContain("B-6");
    expect(offered([80, 40, 80, 40, 80, 40])).toContain("B-6");
    expect(offered([80, 80, 40, 80, 80, 40])).toContain("B-6");
  });

  it("removes B-1 and B-6 after three consecutive months at 75 kW, anywhere in the window", () => {
    expect(offered([75, 75, 75, 40, 40, 40])).toEqual(["B-10", "B-19"]);
    expect(offered([40, 40, 40, 90, 75, 80])).toEqual(["B-10", "B-19"]);
    expect(offered([74.99, 90, 90, 40])).toContain("B-6");
  });

  it("reads the level held, not the peak", () => {
    expect(sustainedKw([10, 50, 30, 40, 35, 5])).toBe(30);
  });

  it("offers nothing on under three months", () => {
    expect(offered([])).toEqual([]);
    expect(offered([40, 40])).toEqual([]);
  });
});

describe("eligibleSchedules", () => {
  it("offers all four schedules to a 40 kW store", () => {
    expect(eligibleSchedules(40)).toEqual(["B-1", "B-6", "B-10", "B-19"]);
  });

  it("offers B-1 and B-6 only under 75 kW", () => {
    expect(eligibleSchedules(74.99)).toContain("B-6");
    expect(eligibleSchedules(74.99)).toContain("B-1");
    for (const kw of [75, 75.01, 400]) {
      expect(eligibleSchedules(kw)).toEqual(["B-10", "B-19"]);
    }
  });

  it("moves to B-19 alone at 500 kW", () => {
    expect(eligibleSchedules(499.99)).toEqual(["B-10", "B-19"]);
    expect(eligibleSchedules(500)).toEqual(["B-19"]);
    expect(eligibleSchedules(999.99)).toEqual(["B-19"]);
  });

  it("offers nothing where B-20 is mandatory, or for a value that is not a number", () => {
    expect(eligibleSchedules(1000)).toEqual([]);
    expect(eligibleSchedules(Number.NaN)).toEqual([]);
  });
});
