import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../../lib/snapshot.ts";
import { EvidenceDrawer } from "./drawer.tsx";

const finding = { type: "arithmeticCheck", title: "Total does not add up", explanation: "x", evidenceJson: null } as unknown as Snapshot["findings"][number];
const replay = { recordedAt: "2026-11-06T10:00:00.000Z", speed: 1.8, startedAt: "2026-11-07T20:00:00.000Z" };
const render = (props: object) => renderToStaticMarkup(createElement(EvidenceDrawer, { finding, onClose: () => {}, ...props }));

describe("EvidenceDrawer", () => {
  it("shows the replay, date and speed line during a replay", () => {
    const html = render({ replay });
    expect(html).toContain('data-testid="drawer-replay-banner"');
    expect(html).toMatch(/REPLAY · recorded Nov 6, 2026.*playing at 1.8× speed/);
  });

  it("shows no replay line on a live run", () => {
    expect(render({ replay: null })).not.toContain("REPLAY");
  });
});
