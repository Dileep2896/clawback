import { describe, expect, it } from "vitest";
import { forwardingProblems, lineAssistant, subsetDiff } from "./assistant.ts";
import { CLOSING_LINE, MENU_LINE, REP_LINES, SPOKEN_TICKET, SYSTEM_PROMPT } from "./script.ts";

describe("script", () => {
  it("reads the fixed ticket digit by digit", () => {
    expect(SPOKEN_TICKET).toBe("B, T, 4, 8, 2, 1, 3");
    expect(REP_LINES.ticket).toBe("Your ticket number is B, T, 4, 8, 2, 1, 3.");
  });

  it("puts every line in the prompt", () => {
    for (const line of [MENU_LINE, ...Object.values(REP_LINES)]) expect(SYSTEM_PROMPT).toContain(`"${line}"`);
  });

  it("only leaves the menu on the whole keypad value", () => {
    expect(SYSTEM_PROMPT).not.toContain("starts with");
    expect(SYSTEM_PROMPT).toContain("is exactly this, with nothing before or after it: User's Keypad Entry: 2\n");
    expect(SYSTEM_PROMPT).toContain("more digits such as User's Keypad Entry: 22 or User's Keypad Entry: 23");
  });

  it("matches the read-back ticket on its exact letters and digits", () => {
    expect(SYSTEM_PROMPT).toContain("letters and digits are exactly BT48213 in that order");
  });

  it("has no line that could claim a tone was received", () => {
    for (const line of [MENU_LINE, CLOSING_LINE, ...Object.values(REP_LINES)]) {
      expect(line).not.toMatch(/received|pressed|key ?press|tone|digit/i);
    }
  });
});

describe("lineAssistant", () => {
  it("waits for the caller, so the disclosure stays first", () => {
    const config = lineAssistant();
    expect(config.firstMessageMode).toBe("assistant-waits-for-user");
    expect(config).not.toHaveProperty("firstMessage");
  });

  it("fixes the closing line in config and listens for tones", () => {
    const config = lineAssistant();
    expect(config.endCallMessage).toBe(CLOSING_LINE);
    expect(config.keypadInputPlan.enabled).toBe(true);
    expect(config.model.tools).toEqual([{ type: "endCall" }]);
  });

  it("cannot forward a call", () => {
    expect(forwardingProblems(lineAssistant(), {})).toEqual([]);
  });
});

describe("forwardingProblems", () => {
  it("catches every route away from the assistant", () => {
    const assistant = {
      model: { tools: [{ type: "endCall" }, { type: "transferCall" }], toolIds: ["t1"] },
      forwardingPhoneNumber: "+15555550100",
      hooks: [{ on: "call.ending" }],
    };
    const phone = { fallbackDestination: { type: "number" }, squadId: "s", workflowId: "w", hooks: [{ on: "call.ringing" }] };
    expect(forwardingProblems(assistant, phone)).toEqual([
      "assistant has tool transferCall",
      "assistant has saved tools attached",
      "assistant has a forwarding number",
      "assistant has hooks",
      "number has hooks",
      "number has a fallback destination",
      "number routes to a squad",
      "number routes to a workflow",
    ]);
  });

  it("applies the same hook rule to the assistant and the number", () => {
    const transfer = [{ on: "call.ringing", do: [{ type: "transfer", destination: { type: "number", number: "+15555550100" } }] }];
    expect(forwardingProblems({ hooks: transfer }, {})).toEqual(["assistant has hooks"]);
    expect(forwardingProblems({}, { hooks: transfer })).toEqual(["number has hooks"]);
    expect(forwardingProblems({ hooks: "unexpected" }, { hooks: "unexpected" })).toEqual(["assistant has hooks", "number has hooks"]);
  });

  it("accepts an empty hooks list, which is no route at all", () => {
    expect(forwardingProblems({ hooks: [] }, { hooks: [] })).toEqual([]);
  });
});

describe("subsetDiff", () => {
  it("ignores extra fields Vapi adds", () => {
    expect(subsetDiff({ a: 1, b: [{ c: 2 }] }, { a: 1, b: [{ c: 2, d: 3 }], e: 4 })).toEqual([]);
  });

  it("names what changed or went missing", () => {
    expect(subsetDiff({ a: 1, b: { c: 2 }, d: [1] }, { a: 9, b: {}, d: [] })).toEqual([".a", ".b.c", ".d"]);
  });
});
