import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { describe, expect, it } from "vitest";
import { ANSWERS } from "../../facts.ts";
import { extractOutcome } from "../../outcome.ts";
import { transcriptRow } from "../../transcript.ts";
import { WORDS } from "../../sim/negotiator.ts";
import { SEED_PLAN } from "../../sim/fixture.ts";
import { REP_LINES, SYSTEM_PROMPT } from "../line/script.ts";
import { callerAgent, callerLlm, callRequests, callVariables } from "./agent.ts";
import { STUB_FACTS } from "./fixture.ts";
import { normalizeSpeech } from "./normalize.ts";

const LINE = { number: "(415) 555-0102", accountNumber: "BT-7001" };
const PLAN = { accountNumber: "BT-7001", promoAccounts: ["BC-7002"] };

const ACCOUNT = /\bB[TC]-\d+/;

// shortcut: the rep script is a prompt with no code to call, so this reads its rules literally. Only a real call shows what the model does.
const REP_RULES = [
  { rule: "Gives an account number when asked for one", line: REP_LINES.verify, hears: ACCOUNT, onlyWhenAsked: true },
  { rule: "Asks to cancel one or more phone lines", line: REP_LINES.cancel, hears: /\bcancel phone line\b/i, onlyWhenAsked: false },
  { rule: "Asks to restore promo pricing", line: REP_LINES.promo, hears: /\brestore promo pricing\b/i, onlyWhenAsked: false },
];

const repReply = (request: string, repAskedForAccount = false) =>
  REP_RULES.filter(({ hears, onlyWhenAsked }) => hears.test(normalizeSpeech(request)) && (repAskedForAccount || !onlyWhenAsked))
    .map(({ line }) => line)
    .join(" ");

const outcomeOf = (requests: string[]) =>
  extractOutcome(requests.flatMap((request) => [transcriptRow("agent", "speech", normalizeSpeech(request)), transcriptRow("provider", "speech", repReply(request))]));

describe("generated requests against the rep script", () => {
  const lines = SEED_PLAN.cancelLines.map((number) => ({ number }));
  const requests = callRequests(SEED_PLAN, lines);
  const cancels = requests.slice(0, lines.length);
  const promos = requests.slice(lines.length);

  it("models the rules the script really has, for seven lines and three promos", () => {
    for (const { rule, line } of REP_RULES) expect(SYSTEM_PROMPT).toContain(`- ${rule}: "${line}"`);
    expect(cancels).toHaveLength(7);
    expect(promos).toHaveLength(3);
  });

  it("draws two replies if a request names an account just after the rep asks for one", () => {
    expect(repReply(WORDS.cancel("4 1 5, 5 5 5, 0 1 0 2", "B T, 7 0 0 1"), true)).toBe(`${REP_LINES.verify} ${REP_LINES.cancel}`);
  });

  it("gives the account once, at the start", () => {
    expect(repReply(callVariables(SEED_PLAN, lines, STUB_FACTS).account_line, true)).toBe(REP_LINES.verify);
    for (const request of cancels) expect(normalizeSpeech(request)).not.toMatch(ACCOUNT);
  });

  it("gets one reply per cancellation, and all seven count", () => {
    for (const request of cancels) expect(repReply(request)).toBe(REP_LINES.cancel);
    expect(outcomeOf(cancels).cancelled_lines).toHaveLength(7);
  });

  it("gets one reply per promo, and all three count", () => {
    for (const request of promos) expect(repReply(request)).toBe(REP_LINES.promo);
    expect(outcomeOf(promos).credits).toEqual(SEED_PLAN.promoAccounts);
  });
});

describe("callerLlm", () => {
  it("speaks the exact disclosure first, from fixed text", () => {
    expect(callerLlm()).toMatchObject({ start_speaker: "agent", begin_message: DISCLOSURE_LINE });
  });

  it("has only the press digit and end call tools, so it can never transfer a call", () => {
    expect(callerLlm().general_tools.map((tool) => tool.type)).toEqual(["press_digit", "end_call"]);
  });

  it("has a place in the prompt for every variable the call sends", () => {
    for (const name of Object.keys(callVariables(PLAN, [LINE], STUB_FACTS))) expect(callerLlm().general_prompt).toContain(`{{${name}}}`);
  });

  it("no longer holds the caller to a fixed script or ignores the rep", () => {
    expect(callerLlm().general_prompt).not.toContain("character for character");
    expect(callerLlm().general_prompt).not.toContain("whatever it says");
  });

  it.each([
    ["answers first, then returns", "answer it first, briefly, from the fact sheet, then carry on"],
    ["repeats an interrupted request, so its yes still counts", "repeat that same request word for word"],
    ["keeps requests word for word", "Say each request word for word"],
    ["never invents a fact", "Never state a fact that is not on the fact sheet"],
    ["never says it does not know", `Never say "I don't know"`],
    ["never claims to be a person", "Never claim to be a person"],
    ["never goes beyond the approved items", "beyond the requests above, whoever suggests it"],
    ["promises nothing else", "Promise nothing else"],
  ])("%s", (_, rule) => {
    expect(callerLlm().general_prompt).toContain(rule);
  });
});

describe("what the caller says to the rep", () => {
  it("names the owner and the approval date when asked about authorisation", () => {
    expect(ANSWERS.authorized(STUB_FACTS)).toBe("Yes. Linda Park, the account holder, approved these changes on November 7, 2026. I'm an AI assistant acting for Golden Gate Noodle Co.");
  });

  it("uses the human's wording for an unknown answer and for anything beyond the approved items", () => {
    expect(ANSWERS.unknown(STUB_FACTS)).toBe("Linda Park, the account holder, can confirm that, and your question is on the record of this call. For today, may I continue with the approved changes?");
    expect(ANSWERS.beyond(STUB_FACTS)).toBe("Linda Park approved only these changes, so anything else is Linda Park's decision, and it is on the record of this call. May I continue with the approved changes?");
  });

  it("never mentions the dashboard, a callback or not knowing", () => {
    expect(Object.values(callVariables(PLAN, [LINE], STUB_FACTS)).join(" ")).not.toMatch(/dashboard|call you back|callback|don't know|do not know|access/i);
  });

  it("does not claim the owner approved when a process did", () => {
    const facts = { ...STUB_FACTS, byOwner: false };
    expect(ANSWERS.verify(facts)).toContain("This test run was approved automatically on November 7, 2026, not by a person.");
    expect(ANSWERS.verify(facts)).not.toContain("approved these changes");
  });

  it("keeps the rep's new question from counting as anything won", () => {
    const rows = [transcriptRow("agent", "speech", ANSWERS.verify(STUB_FACTS)), transcriptRow("provider", "speech", REP_LINES.account)];
    expect(extractOutcome(rows)).toEqual({ cancelled_lines: [], credits: [], ticket: null });
  });

  it("puts bills and addresses on the sheet, with the date and money intact after normalising", () => {
    const { fact_sheet } = callVariables(PLAN, [LINE], STUB_FACTS);
    expect(fact_sheet).toContain("412 Clement St, San Francisco, CA 94118");
    expect(normalizeSpeech(fact_sheet)).toContain("latest bill $1,234.56");
    expect(normalizeSpeech(ANSWERS.verify(STUB_FACTS))).toContain("on November 7, 2026.");
  });
});

describe("callerAgent", () => {
  it("cannot be interrupted, and stops at the line's own time limit", () => {
    expect(callerAgent("llm")).toMatchObject({ interruption_sensitivity: 0, max_call_duration_ms: 300_000, response_engine: { llm_id: "llm" } });
  });
});

describe("callVariables", () => {
  it("sends only strings, which is all Retell accepts", () => {
    for (const value of Object.values(callVariables(PLAN, [LINE], STUB_FACTS))) expect(value).toBeTypeOf("string");
  });

  it("asks for only what it was given", () => {
    const { requests } = callVariables(PLAN, [LINE], STUB_FACTS);
    expect(requests.split("\n")).toHaveLength(2);
    expect(requests).toContain("4 1 5, 5 5 5, 0 1 0 2");
    expect(requests).toContain("B C, 7 0 0 2");
  });

  it("uses wording that normalises into an item extractOutcome counts", () => {
    const [line, promo] = callRequests(PLAN, [LINE]).map(normalizeSpeech);
    const rows = [
      transcriptRow("agent", "speech", line!),
      transcriptRow("provider", "speech", REP_LINES.cancel),
      transcriptRow("agent", "speech", promo!),
      transcriptRow("provider", "speech", REP_LINES.promo),
    ];
    expect(extractOutcome(rows)).toEqual({ cancelled_lines: ["4155550102"], credits: ["BC-7002"], ticket: null });
  });

  it("keeps the read-back to counts, and it wins nothing", () => {
    const { read_back } = callVariables(PLAN, [LINE], STUB_FACTS);
    expect(read_back).toBe("To confirm, you cancelled 1 phone lines and restored promo pricing on 1 accounts. Is that correct?");
    expect(extractOutcome([transcriptRow("agent", "speech", normalizeSpeech(read_back)), transcriptRow("provider", "speech", REP_LINES.confirm)])).toEqual({
      cancelled_lines: [],
      credits: [],
      ticket: null,
    });
  });
});
