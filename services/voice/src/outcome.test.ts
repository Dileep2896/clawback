import { describe, expect, it } from "vitest";
import { MENU_LINE, REP_LINES, SPOKEN_TICKET } from "./live/line/script.ts";
import { extractOutcome } from "./outcome.ts";
import { WORDS } from "./sim/negotiator.ts";
import { SIM_REFUSAL_LINE } from "./sim/rep.ts";
import { transcriptRow, type TranscriptRow } from "./transcript.ts";

const agent = (content: string) => transcriptRow("agent", "speech", content);
const rep = (content: string) => transcriptRow("provider", "speech", content);
const LINE = "(415) 555-0102";
const LINE_KEY = "4155550102";
const OTHER_LINE = "(510) 555-0133";
const NONE = { cancelled_lines: [], credits: [], ticket: null };

describe("extractOutcome", () => {
  it("lists a line and a promo the rep said yes to, and the ticket", () => {
    const rows = [
      agent(WORDS.cancel(LINE, "BT-7001")),
      rep(REP_LINES.cancel),
      agent(WORDS.promo("BC-7002")),
      rep(REP_LINES.promo),
      agent(WORDS.askTicket),
      rep(REP_LINES.ticket),
    ];
    expect(extractOutcome(rows)).toEqual({ cancelled_lines: [LINE_KEY], credits: ["BC-7002"], ticket: "BT-48213" });
  });

  it.each(["+14155550102", "+1 415 555 0102", "1-415-555-0102", "+1 (415) 555-0102", LINE, LINE_KEY])("reads %s as the complete line", (spoken) => {
    expect(extractOutcome([agent(WORDS.cancel(spoken, "BT-7001")), rep(REP_LINES.cancel)]).cancelled_lines).toEqual([LINE_KEY]);
  });

  it("counts one line once, however it was written", () => {
    expect(extractOutcome([agent(`Cancel +14155550102 and ${LINE}.`), rep(REP_LINES.cancel)]).cancelled_lines).toEqual([LINE_KEY]);
  });

  it("leaves out items the rep refused or did not agree to", () => {
    const rows = [
      agent(WORDS.cancel(LINE, "BT-7001")),
      rep(SIM_REFUSAL_LINE),
      agent(WORDS.promo("BC-7002")),
      rep(REP_LINES.other),
      agent(WORDS.cancel(OTHER_LINE, "BT-7012")),
      rep("Yes, but I can't cancel that one."),
    ];
    expect(extractOutcome(rows)).toEqual(NONE);
  });

  it("does not count a line named only in a read-back, even with a yes after it", () => {
    expect(extractOutcome([agent(WORDS.readBack([LINE], ["BC-7002"])), rep(REP_LINES.confirm)])).toEqual(NONE);
  });

  it("does not count a yes to a different kind of request", () => {
    const rows = [agent(WORDS.cancel(LINE, "BT-7001")), rep(REP_LINES.promo), agent(WORDS.promo("BC-7002")), rep(REP_LINES.cancel)];
    expect(extractOutcome(rows)).toEqual(NONE);
  });

  it("counts only the very next row as the answer", () => {
    const rows = [agent(WORDS.cancel(LINE, "BT-7001")), rep(MENU_LINE), rep(REP_LINES.cancel)];
    expect(extractOutcome(rows).cancelled_lines).toEqual([]);
  });

  it("reads no request from a system row, and no answer after a keypress", () => {
    const rows: TranscriptRow[] = [
      transcriptRow("system", "refused", `Refused by code: alarm line ${LINE}, not requested.`),
      rep(REP_LINES.cancel),
      agent(WORDS.cancel(OTHER_LINE, "BT-7012")),
      transcriptRow("agent", "keypress", "2"),
      rep(REP_LINES.cancel),
    ];
    expect(extractOutcome(rows).cancelled_lines).toEqual([]);
  });

  it("accepts a transcribed yes that differs only in punctuation, case or spelling", () => {
    expect(extractOutcome([agent(WORDS.cancel(LINE, "BT-7001")), rep("yes. That is canceled")]).cancelled_lines).toEqual([LINE_KEY]);
  });

  it("takes a ticket only from the rep, and only if shaped like one", () => {
    expect(extractOutcome([agent(`Your ticket number is ${SPOKEN_TICKET}.`)]).ticket).toBeNull();
    expect(extractOutcome([rep("Your ticket number is not available.")]).ticket).toBeNull();
    expect(extractOutcome([]).ticket).toBeNull();
  });
});
