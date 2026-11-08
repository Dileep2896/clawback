import { describe, expect, it } from "vitest";
import { activeAt, advance, dollars, FEE_CENTS, FEED, FREMONT, KEEP_CENTS, LOOP, MAX_FRAME, REFUND_CENTS, rollAt, STEP, SWAP_INDEX, typedAt, TYPE_MS, YEARLY_CENTS } from "./timeline.ts";

describe("landing figures", () => {
  it("match the recorded run's ledger and approval", () => {
    expect(dollars(REFUND_CENTS)).toBe("$12,606.06");
    expect(dollars(YEARLY_CENTS)).toBe("$18,319.32");
    expect(dollars(FEE_CENTS)).toBe("$9,277.61");
    expect(dollars(KEEP_CENTS)).toBe("$21,647.77");
    // The fee is 30% of refund plus first-year savings, to the cent the ledger recorded.
    expect(Math.round((REFUND_CENTS + YEARLY_CENTS) * 0.3)).toBe(FEE_CENTS);
  });

  it("split the Fremont lines at the September 2025 meter change, billing 2x from then on", () => {
    expect(FREMONT[SWAP_INDEX]!.month).toBe("2025-09");
    FREMONT.forEach((point, i) => {
      if (i < SWAP_INDEX) expect(point.billed).toBe(point.meter);
      else expect(point.billed / point.meter).toBeCloseTo(2, 2);
    });
    // 14 overcharged bills, as the finding says.
    expect(FREMONT.length - SWAP_INDEX).toBe(14);
  });
});

describe("hero replay", () => {
  it("renders the finished feed before the clock starts: no entry active, every detail in full", () => {
    expect(activeAt(-1)).toBe(-1);
    FEED.forEach((entry, i) => expect(typedAt(i, -1)).toBe(entry.detail?.length ?? 0));
  });

  it("moves the cursor through the feed in the run's order, then loops", () => {
    expect(FEED.map((entry) => entry.agent)).toEqual(["Collector", "Auditor", "Approver", "Approver", "Negotiator", "Filer", "Finance"]);
    FEED.forEach((_, i) => expect(activeAt(i * STEP)).toBe(i));
    expect(activeAt(LOOP - 1)).toBe(FEED.length - 1);
    expect(activeAt(advance(LOOP - 10, 16, true))).toBe(0);
  });

  it("streams only the active entry's detail, and finishes it well before the cursor moves on", () => {
    const auditor = 1;
    const length = FEED[auditor]!.detail!.length;
    expect(typedAt(auditor, auditor * STEP)).toBe(0);
    expect(typedAt(auditor, auditor * STEP + TYPE_MS / 2)).toBeGreaterThan(0);
    expect(typedAt(auditor, auditor * STEP + TYPE_MS)).toBe(length);
    expect(TYPE_MS).toBeLessThan(STEP);
    // The other entries stay whole meanwhile.
    expect(typedAt(2, auditor * STEP)).toBe(FEED[2]!.detail!.length);
  });

  it("stands still while paused or off-screen, and never jumps after a long frame", () => {
    expect(advance(5_000, 16, false)).toBe(5_000);
    expect(advance(1_000, 60_000, true)).toBe(1_000 + MAX_FRAME);
    expect(advance(1_000, -5, true)).toBe(1_000);
  });
});

describe("roll-up counter", () => {
  it("rises steadily and lands exactly on the figure", () => {
    const samples = Array.from({ length: 11 }, (_, i) => rollAt(REFUND_CENTS, i * 60, 600));
    expect(samples[0]).toBe(0);
    samples.slice(1).forEach((cents, i) => expect(cents).toBeGreaterThanOrEqual(samples[i]!));
    expect(rollAt(REFUND_CENTS, 600, 600)).toBe(REFUND_CENTS);
    expect(rollAt(REFUND_CENTS, 10_000, 600)).toBe(REFUND_CENTS);
  });
});
