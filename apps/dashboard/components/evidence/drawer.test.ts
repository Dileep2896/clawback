import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../../lib/snapshot.ts";
import { findingActivity } from "../../lib/activity.ts";
import { stepFinding } from "../savings/findings.tsx";
import { EvidenceDrawer, navKey } from "./drawer.tsx";

const finding = { type: "arithmeticCheck", title: "Total does not add up", explanation: "x", evidenceJson: null } as unknown as Snapshot["findings"][number];
const replay = { recordedAt: "2026-11-06T10:00:00.000Z", speed: 1.8, startedAt: "2026-11-07T20:00:00.000Z" };
const render = (props: object) => renderToStaticMarkup(createElement(EvidenceDrawer, { finding, onClose: () => {}, ...props }));

describe("EvidenceDrawer", () => {
  it("shows the sandbox pill, with date and speed, during a replay", () => {
    const html = render({ replay });
    expect(html).toContain('data-testid="drawer-replay-banner"');
    expect(html).toContain("Sandbox replay · 1.8×");
    expect(html).toMatch(/recorded Nov 6, 2026.*playing at 1.8× speed/);
  });

  it("shows no sandbox pill on a live run", () => {
    expect(render({ replay: null })).not.toContain("Sandbox replay");
  });
});

describe("drawer navigation (Findings page)", () => {
  const ids = ["big", "mid", "small"];

  it("J/K and the chevrons step through findings and stop at either end", () => {
    expect(stepFinding(ids, "big", 1)).toBe("mid");
    expect(stepFinding(ids, "mid", 1)).toBe("small");
    expect(stepFinding(ids, "small", 1)).toBe("small");
    expect(stepFinding(ids, "mid", -1)).toBe("big");
    expect(stepFinding(ids, "big", -1)).toBe("big");
  });

  it("maps J to next and K to prev, and ignores modifiers and typing in a field", () => {
    const calls: string[] = [];
    const nav = { index: 1, count: 3, prev: () => calls.push("prev"), next: () => calls.push("next") };
    const key = (k: string, extra: object = {}) => navKey({ key: k, metaKey: false, ctrlKey: false, altKey: false, target: {} as EventTarget, ...extra }, nav);
    key("j");
    key("k");
    key("j", { metaKey: true });
    key("x");
    key("j", { target: { closest: (sel: string) => (sel.includes("input") ? {} : null) } });
    expect(calls).toEqual(["next", "prev"]);
  });

  it("updates the counter and disables the chevron at each end", () => {
    const at = (index: number) => render({ nav: { index, count: 3, prev: () => {}, next: () => {} }, activity: [] });
    const first = at(0);
    expect(first).toMatch(/data-testid="drawer-counter"[^>]*>1 \/ 3</);
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous finding/);
    expect(first).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next finding/);
    const last = at(2);
    expect(last).toMatch(/>3 \/ 3</);
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next finding/);
    expect(last).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous finding/);
  });

  it("shows the evidence and activity of the finding it moved to", () => {
    const one = { ...finding, id: "big", title: "Meter multiplier jumped" } as Snapshot["findings"][number];
    const two = { ...finding, id: "mid", title: "Plan costs more than it should" } as Snapshot["findings"][number];
    const snapshot = {
      actions: [{ id: "a1", kind: "dispute", findingId: "big" }],
      approval: null,
      calls: [],
      ledger: [{ id: "l2", kind: "savings", amountCents: 4200, findingId: "mid", createdAt: "2026-11-07T20:00:00.000Z" }],
    } as unknown as Snapshot;
    const show = (f: Snapshot["findings"][number], index: number) =>
      render({ finding: f, nav: { index, count: 3, prev: () => {}, next: () => {} }, activity: findingActivity(f, snapshot) });
    const before = show(one, 0);
    const after = show(two, 1);
    expect(before).toContain("Meter multiplier jumped");
    expect(before).toContain("Proposed");
    expect(before).not.toContain("$42.00");
    expect(after).toContain("Plan costs more than it should");
    expect(after).not.toContain("Meter multiplier jumped");
    expect(after).toContain("Found, not acted on");
    expect(after).toContain("$42.00");
  });
});
