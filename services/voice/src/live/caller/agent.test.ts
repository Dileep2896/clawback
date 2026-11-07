import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { describe, expect, it } from "vitest";
import { extractOutcome } from "../../outcome.ts";
import { transcriptRow } from "../../transcript.ts";
import { WORDS } from "../../sim/negotiator.ts";
import { SEED_PLAN } from "../../sim/fixture.ts";
import { REP_LINES, SYSTEM_PROMPT } from "../line/script.ts";
import { callerAgent, callerLlm, callRequests, callVariables } from "./agent.ts";
import { normalizeSpeech } from "./normalize.ts";

const LINE = { number: "(415) 555-0102", accountNumber: "BT-7001" };
const PLAN = { accountNumber: "BT-7001", promoAccounts: ["BC-7002"] };

// shortcut: the rep script is a prompt with no code to call, so this reads its rules literally. Only a real call shows what the model does.
const REP_RULES = [
  { rule: "Gives an account number", line: REP_LINES.account, hears: /\bB[TC]-\d+/ },
  { rule: "Asks to cancel one or more phone lines", line: REP_LINES.cancel, hears: /\bcancel phone line\b/i },
  { rule: "Asks to restore promo pricing", line: REP_LINES.promo, hears: /\brestore promo pricing\b/i },
];

const repReply = (request: string) =>
  REP_RULES.filter(({ hears }) => hears.test(normalizeSpeech(request)))
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

  it("catches a cancellation that also names an account", () => {
    expect(repReply(WORDS.cancel("4 1 5, 5 5 5, 0 1 0 2", "B T, 7 0 0 1"))).toBe(`${REP_LINES.account} ${REP_LINES.cancel}`);
  });

  it("gives the account once, at the start", () => {
    expect(repReply(callVariables(SEED_PLAN, lines).account_line)).toBe(REP_LINES.account);
  });

  it("gets one reply per cancellation, and all seven count", () => {
    for (const request of cancels) expect(repReply(request)).toBe(REP_LINES.cancel);
    expect(outcomeOf(cancels).cancelled_lines).toHaveLength(7);
  });

  // Known gap, left open by instruction: extractOutcome needs the BC account in the request, and the script answers it as an account number too.
  // When this is fixed, this test should fail and become one reply per promo with all three counted.
  it("still gets two replies per promo, so none of the three count", () => {
    for (const request of promos) expect(repReply(request)).toBe(`${REP_LINES.account} ${REP_LINES.promo}`);
    expect(outcomeOf(promos).credits).toEqual([]);
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
    for (const name of Object.keys(callVariables(PLAN, [LINE]))) expect(callerLlm().general_prompt).toContain(`{{${name}}}`);
  });
});

describe("callerAgent", () => {
  it("cannot be interrupted, and stops at the line's own time limit", () => {
    expect(callerAgent("llm")).toMatchObject({ interruption_sensitivity: 0, max_call_duration_ms: 300_000, response_engine: { llm_id: "llm" } });
  });
});

describe("callVariables", () => {
  it("sends only strings, which is all Retell accepts", () => {
    for (const value of Object.values(callVariables(PLAN, [LINE]))) expect(value).toBeTypeOf("string");
  });

  it("asks for only what it was given", () => {
    const { requests } = callVariables(PLAN, [LINE]);
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
    const { read_back } = callVariables(PLAN, [LINE]);
    expect(read_back).toBe("To confirm, you cancelled 1 phone lines and restored promo pricing on 1 accounts. Is that correct?");
    expect(extractOutcome([transcriptRow("agent", "speech", normalizeSpeech(read_back)), transcriptRow("provider", "speech", REP_LINES.confirm)])).toEqual({
      cancelled_lines: [],
      credits: [],
      ticket: null,
    });
  });
});
