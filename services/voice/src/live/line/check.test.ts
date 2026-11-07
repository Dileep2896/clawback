import { describe, expect, it } from "vitest";
import { type CallMessage, checkLineCall, keypadDigits } from "./check.ts";
import { CLOSING_LINE, MENU_LINE, REP_LINES } from "./script.ts";

// Same shapes as the spike call's real messages (voice-design.md).
const speech = (message: string): CallMessage => ({
  role: "user",
  message,
  time: 1,
  endTime: 6,
  duration: 5,
  metadata: { wordLevelConfidence: [] },
});
const keypad = (digit: string): CallMessage => ({ role: "user", message: `User's Keypad Entry: ${digit}`, time: 7, endTime: 7 });
const bot = (message: string): CallMessage => ({ role: "bot", message, time: 8, endTime: 9, duration: 1 });

const disclosure = speech("Hi. This is an AI assistant calling.");
const goodCall = [
  disclosure,
  // Vapi logged the spike's menu twice though the audio has it once.
  bot(`${MENU_LINE} ${MENU_LINE}`),
  keypad("2"),
  bot(REP_LINES.greeting),
  speech("The account number is 1 2 3."),
  bot(REP_LINES.account),
  { role: "tool_calls", message: "", toolCalls: [{ function: { name: "endCall" } }] },
  bot(CLOSING_LINE),
];

describe("keypadDigits", () => {
  it("reads the platform entry", () => {
    expect(keypadDigits([keypad("2")])).toEqual(["2"]);
  });

  it("does not count a caller saying the same words", () => {
    expect(keypadDigits([speech("User's Keypad Entry: 2")])).toEqual([]);
  });

  it("does not count an entry without both timestamps", () => {
    const message = "User's Keypad Entry: 2";
    expect(keypadDigits([{ role: "user", message }])).toEqual([]);
    expect(keypadDigits([{ role: "user", message, time: 7 }])).toEqual([]);
    expect(keypadDigits([{ role: "user", message, endTime: 7 }])).toEqual([]);
  });
});

describe("checkLineCall", () => {
  it("passes a call that follows the design, even with the menu logged twice", () => {
    expect(checkLineCall(goodCall)).toEqual([]);
  });

  it("fails when the caller only said the digit, even if the rep answered", () => {
    const problems = checkLineCall([disclosure, bot(MENU_LINE), speech("User's Keypad Entry: 2"), bot(REP_LINES.greeting)]);
    expect(problems).toContain("no platform keypad entry for 2");
    expect(problems.some((p) => p.startsWith("off script before the key press"))).toBe(true);
  });

  it("flags a claimed tone as off script", () => {
    const problems = checkLineCall([disclosure, bot(MENU_LINE), keypad("2"), bot(`Key press received. ${REP_LINES.greeting}`)]);
    expect(problems).toEqual(['off script as the rep: "key press received"']);
  });

  it("does not accept another digit", () => {
    expect(checkLineCall([disclosure, bot(MENU_LINE), keypad("3"), bot(MENU_LINE)])).toEqual(["no platform keypad entry for 2"]);
  });

  it("fails if the assistant speaks over the disclosure", () => {
    expect(checkLineCall([bot(MENU_LINE), disclosure, keypad("2"), bot(REP_LINES.greeting)])).toEqual([
      "the assistant spoke before the caller",
    ]);
  });

  it("fails if the rep never answers", () => {
    expect(checkLineCall([disclosure, bot(MENU_LINE), keypad("2")])).toEqual(["the rep never answered after the key press"]);
  });

  it("fails if the bare keypad text has no timestamps, even if the rep answered", () => {
    const bare: CallMessage = { role: "user", message: "User's Keypad Entry: 2" };
    expect(checkLineCall([disclosure, bot(MENU_LINE), bare, bot(REP_LINES.greeting)])).toContain("no platform keypad entry for 2");
  });

  it.each([
    ["an empty message", ""],
    ["only the closing line", CLOSING_LINE],
    ["a rep line without the greeting", REP_LINES.account],
  ])("does not count %s as reaching the rep", (_, line) => {
    expect(checkLineCall([disclosure, bot(MENU_LINE), keypad("2"), bot(line)])).toEqual(["the rep never answered after the key press"]);
  });

  it("does not count the greeting from before the key press", () => {
    expect(checkLineCall([disclosure, bot(MENU_LINE), bot(REP_LINES.greeting), keypad("2"), bot(CLOSING_LINE)])).toContain(
      "the rep never answered after the key press",
    );
  });

  it("fails on any transfer", () => {
    const transfer: CallMessage = { role: "tool_calls", toolCalls: [{ function: { name: "transferCall" } }] };
    expect(checkLineCall([...goodCall, transfer])).toEqual(["used tool transferCall"]);
  });

  it("reports a call where nothing was said", () => {
    expect(checkLineCall([disclosure])).toEqual(["the assistant never spoke"]);
  });
});
