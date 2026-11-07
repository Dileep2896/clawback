import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { describe, expect, it } from "vitest";
import { currentCalls, duration, isDisclosure, nextToSpeak, viewOf } from "./calls.ts";
import type { Snapshot } from "./snapshot.ts";

type Call = Snapshot["calls"][number];

const AT = "2026-11-06T17:00:00.000Z";
const row = (role: string, kind: string, content: string) => ({ role, kind, content, at: AT });
const disclosure = row("agent", "speech", DISCLOSURE_LINE);
const menu = row("provider", "speech", "For billing, press 2.");
const press = row("agent", "keypress", "2");

// The exact rows from services/voice/src/live/caller/engine.ts on fleet/voice-live-caller. If that text changes, these must too.
const IN_PROGRESS = row("system", "status", "Live call in progress.");
const WITH_ID = row("system", "status", "Live call in progress. Retell call call_abc.");
const ENDED = row("system", "status", "Retell call call_abc ended: user_hangup.");
const FAILED = row("system", "status", "Live call failed: Retell call call_abc: the call ended with no ticket number: user_hangup");
const FALLBACK = row("system", "fallback", "Live call failed, so this call is simulated: Retell GET /v2/get-call/call_abc: HTTP 500: down");

const call = (over: Partial<Call>): Call => ({
  id: "c1",
  actionId: "a1",
  mode: "sim",
  toNumber: "+15550003333",
  startedAt: AT,
  endedAt: null,
  recordingUrl: null,
  transcriptJson: [disclosure],
  outcomeJson: null,
  ...over,
});

describe("currentCalls", () => {
  it("keeps the newest row of an action, so a failed live attempt gives way to its sim fallback", () => {
    const live = call({ id: "live", mode: "live", endedAt: AT, transcriptJson: [IN_PROGRESS, WITH_ID, FAILED] });
    const sim = call({ id: "sim", transcriptJson: [disclosure, FALLBACK, menu] });
    expect(currentCalls([live, sim]).map((c) => c.id)).toEqual(["sim"]);
  });

  it("keeps one row per action", () => {
    const calls = [call({ id: "one", actionId: "a1" }), call({ id: "two", actionId: "a2" })];
    expect(currentCalls(calls).map((c) => c.id)).toEqual(["one", "two"]);
  });
});

describe("viewOf", () => {
  it("shows the disclosure first and the fallback row only as the label", () => {
    const view = viewOf(call({ transcriptJson: [disclosure, FALLBACK, menu, press] }));
    expect(view.state).toBe("transcript");
    expect(view.fallback).toBe("Live call failed, so this call is simulated: Retell GET /v2/get-call/the call: HTTP 500: down");
    expect(view.rows).toEqual([disclosure, menu, press]);
    expect(isDisclosure(view.rows[0]!)).toBe(true);
  });

  it("shows a live call in progress with its status rows off the screen", () => {
    const view = viewOf(call({ mode: "live", transcriptJson: [IN_PROGRESS, WITH_ID] }));
    expect(view).toEqual({ state: "in-progress", fallback: null, failure: null, rows: [] });
  });

  it("shows a finished live call whole, without the status row that holds the Retell id", () => {
    const view = viewOf(call({ mode: "live", endedAt: AT, transcriptJson: [disclosure, menu, press, ENDED] }));
    expect(view.state).toBe("transcript");
    expect(view.rows).toEqual([disclosure, menu, press]);
    expect(JSON.stringify(view)).not.toContain("call_abc");
  });

  it("keeps a failed attempt's partial transcript out when no sim call replaced it", () => {
    const view = viewOf(call({ mode: "live", endedAt: AT, transcriptJson: [disclosure, menu, ENDED, FAILED] }));
    expect(view).toEqual({ state: "failed", fallback: null, failure: "Live call failed: Retell call the call: the call ended with no ticket number: user_hangup", rows: [] });
  });

  it("replaces every Retell id in the fallback and failure text", () => {
    const twoIds = row("system", "status", "Live call failed: call_abc1 then call_DEF_2.");
    expect(viewOf(call({ mode: "live", endedAt: AT, transcriptJson: [twoIds] })).failure).toBe("Live call failed: the call then the call.");
    expect(viewOf(call({ transcriptJson: [disclosure, FALLBACK] })).fallback).not.toContain("call_");
  });

  it("keeps refused rows, as system rows", () => {
    const refused = row("system", "refused", "Refused by code: alarm line +15550004008, not requested.");
    expect(viewOf(call({ transcriptJson: [disclosure, refused] })).rows).toEqual([disclosure, refused]);
  });

  it("leaves out a kind it does not know, and does not crash on an unreadable transcript", () => {
    expect(viewOf(call({ transcriptJson: [disclosure, row("system", "brand_new", "x")] })).rows).toEqual([disclosure]);
    for (const transcriptJson of [null, "not rows", [{ role: 1 }]]) expect(viewOf(call({ transcriptJson })).rows).toEqual([]);
  });

  it("marks only the disclosure as the disclosure", () => {
    expect(isDisclosure(menu)).toBe(false);
    expect(isDisclosure(row("provider", "speech", DISCLOSURE_LINE))).toBe(false);
    expect(isDisclosure(row("agent", "speech", `${DISCLOSURE_LINE} For billing?`))).toBe(true);
  });
});

describe("nextToSpeak", () => {
  it("speaks a new call from its disclosure, in order, once each", () => {
    const said = new Map<string, number>();
    expect(nextToSpeak([], said, true)).toEqual([]);
    expect(nextToSpeak([call({ transcriptJson: [disclosure] })], said, false)).toEqual([disclosure]);
    expect(nextToSpeak([call({ transcriptJson: [disclosure, menu] })], said, false)).toEqual([menu]);
    expect(nextToSpeak([call({ transcriptJson: [disclosure, menu] })], said, false)).toEqual([]);
  });

  it("speaks neither a key press, nor a refused row, nor the fallback label", () => {
    const refused = row("system", "refused", "Refused by code: alarm line, not requested.");
    const rows = [disclosure, FALLBACK, press, refused, menu];
    expect(nextToSpeak([call({ transcriptJson: rows })], new Map(), false)).toEqual([disclosure, menu]);
  });

  it("does not read out what is already on screen when the page loads, only what follows", () => {
    const said = new Map<string, number>();
    expect(nextToSpeak([call({ transcriptJson: [disclosure, menu] })], said, true)).toEqual([]);
    const later = row("provider", "speech", "How can I help?");
    expect(nextToSpeak([call({ transcriptJson: [disclosure, menu, later] })], said, false)).toEqual([later]);
  });

  it("never speaks a live call", () => {
    const live = call({ mode: "live", endedAt: AT, transcriptJson: [disclosure, menu, ENDED] });
    expect(nextToSpeak([live], new Map(), false)).toEqual([]);
  });
});

describe("duration", () => {
  it("reads as minutes and seconds", () => {
    expect(duration(AT, "2026-11-06T17:00:05.900Z")).toBe("0:05");
    expect(duration(AT, "2026-11-06T17:02:03.000Z")).toBe("2:03");
    expect(duration(AT, new Date(AT).getTime() + 600_000)).toBe("10:00");
  });

  it("never goes below zero when the clocks disagree", () => {
    expect(duration(AT, "2026-11-06T16:59:00.000Z")).toBe("0:00");
  });
});
