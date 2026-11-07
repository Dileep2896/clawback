import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { describe, expect, it } from "vitest";
import { extractOutcome } from "../../outcome.ts";
import { transcriptRow } from "../../transcript.ts";
import { REP_LINES } from "../line/script.ts";
import { callerAgent, callerLlm, callRequests, callVariables } from "./agent.ts";
import { normalizeSpeech } from "./normalize.ts";

const LINE = { number: "(415) 555-0102", accountNumber: "BT-7001" };
const PLAN = { accountNumber: "BT-7001", promoAccounts: ["BC-7002"] };

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
