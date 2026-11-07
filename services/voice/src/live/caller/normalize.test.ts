import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { describe, expect, it } from "vitest";
import { extractOutcome } from "../../outcome.ts";
import { SEED_PLAN } from "../../sim/fixture.ts";
import { lineKey } from "../../sim/engine.ts";
import { SIM_REFUSAL_LINE } from "../../sim/rep.ts";
import { REP_LINES } from "../line/script.ts";
import { fullCallItems, press, said, START_MS } from "./fixture.ts";
import { normalizeSpeech, retellToRows } from "./normalize.ts";

const LINE = { number: "(415) 555-0102", accountNumber: "BT-7001" };
const LINE_KEY = "4155550102";
const rows = (...items: Parameters<typeof retellToRows>[0]) => retellToRows(items, START_MS);
const outcomeOf = (...items: Parameters<typeof retellToRows>[0]) => extractOutcome(rows(...items));

describe("the spike's recorded transcript", () => {
  it("reads as our rows, with the number as a digit and the key press in its place", () => {
    const result = rows(said("agent", DISCLOSURE_LINE), said("user", "For billing, press two."), ...press("2"), said("user", "Goodbye."));
    expect(result.map(({ role, kind, content }) => [role, kind, content])).toEqual([
      ["agent", "speech", DISCLOSURE_LINE],
      ["provider", "speech", "For billing, press 2."],
      ["agent", "keypress", "2"],
      ["provider", "speech", "Goodbye."],
    ]);
  });

  it("leaves the disclosure word for word", () => {
    expect(normalizeSpeech(DISCLOSURE_LINE)).toBe(DISCLOSURE_LINE);
  });

  it("reads the items' start times as offsets from the call start", () => {
    const [row] = rows({ role: "agent", content: "Hi", words: [{ start: 1.5 }] });
    expect(row!.at).toBe(new Date(START_MS + 1500).toISOString());
  });
});

describe("normalizeSpeech", () => {
  it.each([
    ["four one five, five five five, oh one oh two", "4155550102"],
    ["4 1 5, 5 5 5, 0 1 0 2", "4155550102"],
    ["415-555-0102", "4155550102"],
    ["(415) 555-0102", "(4155550102"],
    ["B C, seven zero zero two", "BC-7002"],
    ["b t, 7 0 0 1", "BT-7001"],
    ["bee see 7002", "BC-7002"],
    ["BC-7002", "BC-7002"],
    ["b, t, four, eight, two, one, three", "BT-48213"],
  ])("reads %s as %s", (spoken, expected) => {
    expect(normalizeSpeech(spoken)).toBe(expected);
  });

  it.each(["Yes, that is cancelled.", "I can't cancel that one.", "Oh, thanks.", "Can we be there to see it?", REP_LINES.other, "approved on November 7, 2026.", "The latest bill was $1,234.56.", "It was $95.00 for 412 Clement St, CA 94118."])("leaves %s alone", (text) => {
    expect(normalizeSpeech(text)).toBe(text);
  });
});

describe("retellToRows", () => {
  it("joins split utterances, but never across a key press", () => {
    const result = rows(said("user", "For billing,"), said("user", "press two."), ...press("2"), said("user", "BayTel billing."));
    expect(result.map((row) => row.content)).toEqual(["For billing, press 2.", "2", "BayTel billing."]);
  });

  it("joins a number split across utterances", () => {
    expect(rows(said("agent", "Cancel 4 1 5, 5 5 5,"), said("agent", "0 1 0 2 please."))[0]!.content).toBe("Cancel 4155550102 please.");
  });

  it.each([
    ["unsuccessful", press("2", false)],
    ["with no result", press("2").slice(0, 1)],
    ["with broken arguments", [{ role: "tool_call_invocation", tool_call_id: "x", name: "press_digit", arguments: "{" }, { role: "tool_call_result", tool_call_id: "x", successful: true }]],
    ["for more than one key", press("22")],
  ])("records no key press for a press %s", (_, items) => {
    expect(rows(...items)).toEqual([]);
  });

  it("drops other tool calls and roles", () => {
    const items = [
      { role: "tool_call_invocation", tool_call_id: "e", name: "end_call", arguments: "{}" },
      { role: "tool_call_result", tool_call_id: "e", content: "ended", successful: true },
      { role: "dtmf", digit: "2" },
      { role: "node_transition" },
      said("user", "   "),
    ];
    expect(rows(...items)).toEqual([]);
  });
});

describe("extractOutcome on a normalised live transcript", () => {
  const plan = { accountNumber: LINE.accountNumber, promoAccounts: ["BC-7002"] };

  it("finds every item and the ticket in a full call", () => {
    const lines = SEED_PLAN.cancelLines.map((number) => ({ number, accountNumber: "BT-7001" }));
    const outcome = extractOutcome(retellToRows(fullCallItems(SEED_PLAN, lines), START_MS));
    expect(outcome.cancelled_lines).toEqual(SEED_PLAN.cancelLines.map(lineKey));
    expect(outcome.cancelled_lines).toHaveLength(7);
    expect(outcome.credits).toEqual(SEED_PLAN.promoAccounts);
    expect(outcome.credits).toHaveLength(3);
    expect(outcome.ticket).toBe("BT-48213");
  });

  it("would lose the items without normalising, so the step is doing real work", () => {
    const raw = fullCallItems(plan, [LINE]).flatMap((item) =>
      item.content ? [{ role: item.role === "agent" ? ("agent" as const) : ("provider" as const), kind: "speech" as const, content: item.content, at: "" }] : [],
    );
    expect(extractOutcome(raw)).toEqual({ cancelled_lines: [], credits: [], ticket: null });
  });

  it("counts a yes split across utterances", () => {
    expect(outcomeOf(said("agent", "Please cancel phone line 4 1 5, 5 5 5, 0 1 0 2."), said("user", "Yes,"), said("user", "that is cancelled.")).cancelled_lines).toEqual([LINE_KEY]);
  });

  it("does not count a refusal", () => {
    expect(outcomeOf(said("agent", "Please cancel phone line four one five, five five five, oh one oh two."), said("user", SIM_REFUSAL_LINE)).cancelled_lines).toEqual([]);
  });

  it("does not count a yes joined to a refusal", () => {
    expect(outcomeOf(said("agent", "Please cancel phone line 4 1 5, 5 5 5, 0 1 0 2."), said("user", "Yes, that is cancelled."), said("user", "Actually no, I can't.")).cancelled_lines).toEqual([]);
  });

  it("does not count a yes after the caller has spoken again", () => {
    const items = [said("agent", "Please cancel phone line 4 1 5, 5 5 5, 0 1 0 2."), said("user", "Yes,"), said("agent", "Sorry?"), said("user", "that is cancelled.")];
    expect(outcomeOf(...items).cancelled_lines).toEqual([]);
  });

  it("does not count one reply to two requests, which is why the caller asks one at a time", () => {
    const items = [said("agent", "Cancel 4 1 5, 5 5 5, 0 1 0 2 and restore B C, 7 0 0 2."), said("user", `${REP_LINES.cancel} ${REP_LINES.promo}`)];
    expect(outcomeOf(...items)).toEqual({ cancelled_lines: [], credits: [], ticket: null });
  });

  it("takes no ticket from the caller repeating one", () => {
    expect(outcomeOf(said("agent", "Your ticket number is B, T, 4, 8, 2, 1, 3.")).ticket).toBeNull();
  });
});
