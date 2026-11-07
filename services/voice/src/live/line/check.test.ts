import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
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
const at = (m: CallMessage, time: number, endTime: number): CallMessage => ({ ...m, time, endTime });

// Lays messages out one after another, so a test's listed order is also its timestamp order.
function check(messages: CallMessage[]): string[] {
  let next = 1;
  return checkLineCall(
    messages.map((m) => {
      if (m.time === undefined || m.endTime === undefined) return m;
      const placed = at(m, next, next + m.endTime - m.time);
      next = (placed.endTime ?? next) + 1;
      return placed;
    }),
  );
}

// Vapi's real transcript of the spike's disclosure: only the punctuation differs from DISCLOSURE_LINE.
const disclosure = speech("Hi. This is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded.");
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

  it.each(["User's Keypad Entry:", "User's Keypad Entry: 1: 2", "User's Keypad Entry: 2 ", "User's Keypad Entry: 2 3", "User's Keypad Entry: two"])(
    "does not count the malformed entry %j",
    (message) => {
      expect(keypadDigits([{ role: "user", message, time: 7, endTime: 7 }])).toEqual([]);
    },
  );
});

describe("checkLineCall", () => {
  it("passes a call that follows the design, even with the menu logged twice", () => {
    expect(check(goodCall)).toEqual([]);
  });

  it("fails when the caller only said the digit, even if the rep answered", () => {
    const problems = check([disclosure, bot(MENU_LINE), speech("User's Keypad Entry: 2"), bot(REP_LINES.greeting)]);
    expect(problems).toContain("no platform keypad entry for 2");
    expect(problems.some((p) => p.startsWith("off script before the key press"))).toBe(true);
  });

  it("flags a claimed tone as off script", () => {
    const problems = check([disclosure, bot(MENU_LINE), keypad("2"), bot(`Key press received. ${REP_LINES.greeting}`)]);
    expect(problems).toEqual(['off script as the rep: "key press received"', "the rep did not open with its greeting after the key press"]);
  });

  it("does not accept another digit", () => {
    expect(check([disclosure, bot(MENU_LINE), keypad("3"), bot(MENU_LINE)])).toEqual(["no platform keypad entry for 2"]);
  });

  it("fails if the assistant speaks over the disclosure", () => {
    expect(check([bot(MENU_LINE), disclosure, keypad("2"), bot(REP_LINES.greeting)])).toEqual([
      "the assistant spoke before the caller",
    ]);
  });

  it.each([
    ["a greeting with no disclosure", [speech("Hello")]],
    ["a disclosure cut short", [speech("Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company.")]],
    ["a disclosure without the AI statement", [speech("Hi, this is calling on behalf of Golden Gate Noodle Company. This call is being recorded.")]],
    ["words before the disclosure", [speech("Hello."), disclosure]],
  ])("fails on %s", (_, opening) => {
    expect(check([...opening, bot(MENU_LINE), keypad("2"), bot(REP_LINES.greeting)])).toContain(
      "the caller did not open with the full disclosure",
    );
  });

  it("accepts a disclosure the transcriber split across messages", () => {
    const split = [speech("Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company."), speech("This call is being recorded.")];
    expect(check([...split, bot(MENU_LINE), keypad("2"), bot(REP_LINES.greeting)])).toEqual([]);
  });

  it("does not count disclosure words said after the menu", () => {
    const problems = check([speech("Hello"), bot(MENU_LINE), disclosure, keypad("2"), bot(REP_LINES.greeting)]);
    expect(problems).toContain("the caller did not open with the full disclosure");
  });

  it("fails if the rep never answers", () => {
    expect(check([disclosure, bot(MENU_LINE), keypad("2")])).toEqual(["the rep did not open with its greeting after the key press"]);
  });

  it("fails if the bare keypad text has no timestamps, even if the rep answered", () => {
    const bare: CallMessage = { role: "user", message: "User's Keypad Entry: 2" };
    expect(check([disclosure, bot(MENU_LINE), bare, bot(REP_LINES.greeting)])).toContain("no platform keypad entry for 2");
  });

  it.each([
    ["an empty message", ""],
    ["only the closing line", CLOSING_LINE],
    ["a rep line without the greeting", REP_LINES.account],
  ])("does not count %s as reaching the rep", (_, line) => {
    expect(check([disclosure, bot(MENU_LINE), keypad("2"), bot(line)])).toEqual(["the rep did not open with its greeting after the key press"]);
  });

  it("does not count the greeting from before the key press", () => {
    expect(check([disclosure, bot(MENU_LINE), bot(REP_LINES.greeting), keypad("2"), bot(CLOSING_LINE)])).toContain(
      "the rep did not open with its greeting after the key press",
    );
  });

  it("fails on any transfer", () => {
    const transfer: CallMessage = { role: "tool_calls", toolCalls: [{ function: { name: "transferCall" } }] };
    expect(check([...goodCall, transfer])).toEqual(["used tool transferCall"]);
  });

  it("reports a call where nothing was said", () => {
    expect(check([disclosure])).toEqual(["the assistant never spoke"]);
  });

  describe("exact values", () => {
    it.each(["22", "23", "12", "1: 2"])("does not take keypad entry %s as 2", (digits) => {
      expect(check([disclosure, bot(MENU_LINE), keypad(digits), bot(REP_LINES.greeting)])).toContain("no platform keypad entry for 2");
    });

    it("does not take a word that only starts like the disclosure's last word", () => {
      expect(check([speech(`${DISCLOSURE_LINE.slice(0, -1)}ly.`), bot(MENU_LINE), keypad("2"), bot(REP_LINES.greeting)])).toContain(
        "the caller did not open with the full disclosure",
      );
    });

    it("flags off-script words in any alphabet", () => {
      expect(check([disclosure, bot(MENU_LINE), keypad("2"), bot(`${REP_LINES.greeting} 你好`)])).toEqual(['off script as the rep: "你好"']);
    });
  });

  describe("ordering by timestamps", () => {
    const key = at(keypad("2"), 7, 7);
    const greeting = at(bot(REP_LINES.greeting), 8, 9);

    it("fails when the menu starts during the disclosure", () => {
      expect(checkLineCall([at(disclosure, 1, 6), at(bot(MENU_LINE), 3, 4), key, greeting])).toEqual(["the assistant spoke over the disclosure"]);
    });

    it("fails when a split disclosure's last part runs into the menu", () => {
      const first = at(speech("Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company."), 1, 3);
      const last = at(speech("This call is being recorded."), 3, 6);
      expect(checkLineCall([first, last, at(bot(MENU_LINE), 5, 6.5), key, greeting])).toEqual(["the assistant spoke over the disclosure"]);
    });

    it("passes when the menu starts the moment the disclosure ends", () => {
      expect(checkLineCall([at(disclosure, 1, 6), at(bot(MENU_LINE), 6, 7), key, greeting])).toEqual([]);
    });

    it("uses timestamps, not log position", () => {
      expect(checkLineCall([greeting, key, at(bot(MENU_LINE), 6, 7), at(disclosure, 1, 6)])).toEqual([]);
    });

    it("fails a menu logged after the disclosure but timed before it", () => {
      expect(checkLineCall([at(disclosure, 2, 6), at(bot(MENU_LINE), 1, 2), key, greeting])).toContain("the assistant spoke before the caller");
    });

    it("fails a greeting logged after the key press but timed before it", () => {
      const problems = checkLineCall([at(disclosure, 1, 3), at(bot(MENU_LINE), 3, 4), key, at(bot(REP_LINES.greeting), 5, 6)]);
      expect(problems).toContain("the rep did not open with its greeting after the key press");
    });

    it.each([
      ["during the menu", 5],
      ["before the menu", 2],
    ])("fails a key press %s", (_, time) => {
      const problems = checkLineCall([at(disclosure, 1, 2), at(bot(MENU_LINE), 4, 6), at(keypad("2"), time, time), greeting]);
      expect(problems).toContain("the key was pressed before the menu finished");
    });

    it("fails a rep line before the greeting", () => {
      expect(check([disclosure, bot(MENU_LINE), keypad("2"), bot(REP_LINES.account), bot(REP_LINES.greeting)])).toContain(
        "the rep did not open with its greeting after the key press",
      );
    });

    it("fails a rep line before the greeting in the same message", () => {
      expect(check([disclosure, bot(MENU_LINE), keypad("2"), bot(`${REP_LINES.account} ${REP_LINES.greeting}`)])).toEqual([
        "the rep did not open with its greeting after the key press",
      ]);
    });

    it("fails the closing line before the menu in the same message", () => {
      expect(check([disclosure, bot(`${CLOSING_LINE} ${MENU_LINE}`), keypad("2"), bot(REP_LINES.greeting)])).toContain(
        "the first thing said was not the menu",
      );
    });

    it("skips an empty log entry before the greeting", () => {
      expect(check([disclosure, bot(MENU_LINE), keypad("2"), bot(""), bot(REP_LINES.greeting)])).toEqual([]);
    });

    it.each([
      ["a later message", [bot(CLOSING_LINE), bot(REP_LINES.account)]],
      ["the same message", [bot(`${CLOSING_LINE} ${REP_LINES.account}`)]],
    ])("fails speech after the closing line in %s", (_, ending) => {
      expect(check([disclosure, bot(MENU_LINE), keypad("2"), bot(REP_LINES.greeting), ...ending])).toEqual(["the assistant spoke after its closing line"]);
    });

    it("allows the closing line logged twice", () => {
      expect(check([...goodCall, bot(CLOSING_LINE)])).toEqual([]);
    });
  });

  describe("missing fields", () => {
    const strip = (m: CallMessage, ...fields: ("time" | "endTime")[]): CallMessage => {
      const copy = { ...m };
      for (const field of fields) delete copy[field];
      return copy;
    };

    it.each([
      ["no times", ["time", "endTime"] as const],
      ["no start", ["time"] as const],
      ["no end", ["endTime"] as const],
    ])("does not trust a disclosure with %s", (_, fields) => {
      const problems = checkLineCall([strip(at(disclosure, 1, 6), ...fields), at(bot(MENU_LINE), 7, 8), at(keypad("2"), 9, 9), at(bot(REP_LINES.greeting), 10, 11)]);
      expect(problems).toContain(`a user message has no valid timestamps: "${disclosure.message}"`);
      expect(problems).toContain("the assistant spoke before the caller");
    });

    it("does not trust a rep greeting with no timestamps", () => {
      const problems = checkLineCall([at(disclosure, 1, 6), at(bot(MENU_LINE), 7, 8), at(keypad("2"), 9, 9), strip(bot(REP_LINES.greeting), "time", "endTime")]);
      expect(problems).toContain(`a bot message has no valid timestamps: "${REP_LINES.greeting}"`);
      expect(problems).toContain("the rep did not open with its greeting after the key press");
    });

    it("does not trust a message that ends before it starts", () => {
      expect(checkLineCall([at(disclosure, 6, 1), at(bot(MENU_LINE), 7, 8)])).toContain(`a user message has no valid timestamps: "${disclosure.message}"`);
    });

    it("reports a menu with no text", () => {
      const noText = strip(bot(MENU_LINE));
      delete noText.message;
      expect(check([disclosure, noText, keypad("2"), bot(REP_LINES.greeting)])).toContain("the first thing said was not the menu");
    });

    it.each([
      ["no tools field", { role: "tool_calls" }],
      ["an empty tools list", { role: "tool_calls", toolCalls: [] }],
    ])("fails a tool entry with %s", (_, entry) => {
      expect(check([...goodCall, entry])).toEqual(["a tool call entry names no tool"]);
    });

    it("still reports a transfer when the assistant never spoke", () => {
      const transfer: CallMessage = { role: "tool_calls", toolCalls: [{ function: { name: "transferCall" } }] };
      expect(check([disclosure, transfer])).toEqual(["used tool transferCall", "the assistant never spoke"]);
    });
  });
});
