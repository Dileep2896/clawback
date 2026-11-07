import type { Db } from "@bill-fighter/db/client";
import { calls } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { createLlm, type Query } from "@bill-fighter/platform/local/llm";
import type { JsonSchema, Llm, LlmInput } from "@bill-fighter/platform/types";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLOSING_LINE, LINE_NUMBER, MENU_LINE, REP_LINES, SPOKEN_TICKET, SYSTEM_PROMPT } from "../live/line/script.ts";
import type { TranscriptRow } from "../transcript.ts";
import { runSimCall } from "./engine.ts";
import { ALARM_LINES, SEED_PLAN, seedCallData } from "./fixture.ts";
import type { Move } from "./negotiator.ts";
import { SIM_REFUSAL_LINE } from "./rep.ts";

const test = (name: string, fn: (db: Db) => Promise<void>) =>
  it(name, () =>
    withTestDb("voice_sim", async (db) => {
      await seedCallData(db, "action");
      await fn(db);
    }),
  );

function repAnswer(prompt: string) {
  const last = prompt.split("\n").at(-1)!;
  if (last === `Caller: ${DISCLOSURE_LINE}`) return { lines: [MENU_LINE], endCall: false };
  if (last === "Caller: User's Keypad Entry: 2") return { lines: [REP_LINES.greeting], endCall: false };
  if (last.includes("To confirm") || last.includes("repeat")) return { lines: [REP_LINES.confirm], endCall: false };
  if (last.includes("account number is")) return { lines: [REP_LINES.account], endCall: false };
  if (last.includes("cancel")) return { lines: [REP_LINES.cancel], endCall: false };
  if (last.includes("promo")) return { lines: [REP_LINES.promo], endCall: false };
  if (last.includes("ticket number")) return { lines: [REP_LINES.ticket], endCall: false };
  if (last.includes("Goodbye")) return { lines: [], endCall: true };
  return { lines: [REP_LINES.other], endCall: false };
}

// `nextMove` goes first, so a test can make the model ask for something bad. Returning null plays the call normally.
function stubLlm(options: { nextMove?: (allowed: string[]) => Move | null; rep?: (input: LlmInput) => unknown } = {}) {
  const lines = [...SEED_PLAN.cancelLines];
  const promos = [...SEED_PLAN.promoAccounts];
  const inputs: { kind: "rep" | "negotiator"; input: LlmInput }[] = [];
  const llm: Llm = {
    async structured<T>(input: LlmInput, schema: JsonSchema) {
      const properties = schema.properties as { move?: { enum: Move["move"][] } };
      if (!properties.move) {
        inputs.push({ kind: "rep", input });
        return (options.rep?.(input) ?? repAnswer(input.prompt)) as T;
      }
      inputs.push({ kind: "negotiator", input });
      const allowed = properties.move.enum;
      const forced = options.nextMove?.(allowed);
      if (forced) return forced as T;
      const move = allowed[0]!;
      const target = move === "press_digit" ? "2" : move === "cancel_line" ? lines.shift()! : move === "restore_promo" ? promos.shift()! : "";
      return { move, target } as T;
    },
  };
  return { llm, inputs };
}

const transcript = async (db: Db) => {
  const [call] = await db.select().from(calls);
  return { call: call!, rows: call!.transcriptJson as TranscriptRow[] };
};
const said = (rows: TranscriptRow[], role: TranscriptRow["role"]) => rows.filter((r) => r.role === role).map((r) => r.content);

// Wraps a stub to record how many rows were stored at the moment of each model call.
function recordingSizes(db: Db, llm: Llm) {
  const sizes: number[] = [];
  const spying: Llm = {
    async structured<T>(input: LlmInput, schema: JsonSchema) {
      sizes.push((await transcript(db)).rows.length);
      return llm.structured<T>(input, schema);
    },
  };
  return { sizes, spying };
}

afterEach(() => vi.unstubAllGlobals());

describe("runSimCall", () => {
  test("the first row is the exact disclosure, stored before any model is asked", async (db) => {
    const { sizes, spying } = recordingSizes(db, stubLlm().llm);
    await runSimCall({ db, llm: spying, actionId: "action", plan: SEED_PLAN });
    expect(sizes[0]).toBe(1);
    expect((await transcript(db)).rows[0]).toMatchObject({ role: "agent", kind: "speech", content: DISCLOSURE_LINE });
  });

  test("the disclosure stays first even if the rep answers with something else", async (db) => {
    const { llm } = stubLlm({ rep: () => ({ lines: [REP_LINES.other], endCall: true }) });
    await expect(runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN })).rejects.toThrow(/early/);
    expect((await transcript(db)).rows[0]!.content).toBe(DISCLOSURE_LINE);
  });

  test("a full call runs with no human and no network, in order", async (db) => {
    const fetch = vi.fn(() => {
      throw new Error("no network in sim");
    });
    vi.stubGlobal("fetch", fetch);
    const { callId } = await runSimCall({ db, llm: stubLlm().llm, actionId: "action", plan: SEED_PLAN });
    const { call, rows } = await transcript(db);

    expect(fetch).not.toHaveBeenCalled();
    expect(call).toMatchObject({ id: callId, mode: "sim", toNumber: LINE_NUMBER, actionId: "action" });
    expect(call.endedAt).toBeInstanceOf(Date);
    expect(rows.filter((r) => r.kind === "keypress")).toMatchObject([{ role: "agent", content: "2" }]);

    const agent = rows.filter((r) => r.role === "agent" && r.kind === "speech").map((r) => r.content);
    expect(agent[0]).toBe(DISCLOSURE_LINE);
    expect(agent[1]).toBe("The account number is BT-7001.");
    expect(agent.filter((l) => l.startsWith("Please cancel"))).toHaveLength(7);
    expect(agent).toContain("Please cancel phone line (415) 555-0102 on account BT-7001.");
    expect(agent).toContain("Please cancel phone line (510) 555-0133 on account BT-7012.");
    expect(agent.filter((l) => l.startsWith("Please restore"))).toEqual([
      "Please restore promo pricing on BayConnect internet account BC-7002.",
      "Please restore promo pricing on BayConnect internet account BC-7008.",
      "Please restore promo pricing on BayConnect internet account BC-7012.",
    ]);
    expect(agent.at(-4)).toMatch(/^To confirm, you cancelled phone lines .*BayConnect accounts BC-7002, BC-7008, BC-7012\. Is that correct\?$/);
    expect(agent.slice(-3)).toEqual(["Can I have a ticket number, please?", `Let me repeat that: ${SPOKEN_TICKET}.`, "That's everything, thank you. Goodbye."]);

    const provider = said(rows, "provider");
    expect(provider.slice(0, 2)).toEqual([MENU_LINE, REP_LINES.greeting]);
    expect(provider.filter((l) => l === REP_LINES.cancel)).toHaveLength(7);
    expect(provider.filter((l) => l === REP_LINES.promo)).toHaveLength(3);
    expect(provider).toContain(REP_LINES.ticket);
    expect(provider.at(-1)).toBe(CLOSING_LINE);
    expect(rows.some((r) => r.role === "system")).toBe(false);
  });

  test("the rep runs on the imported script and hears the key as Vapi reports it", async (db) => {
    const { llm, inputs } = stubLlm();
    await runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN });
    const rep = inputs.filter((i) => i.kind === "rep");
    expect(rep[0]!.input.system).toContain(SYSTEM_PROMPT);
    expect(rep[1]!.input.prompt.split("\n").at(-1)).toBe("Caller: User's Keypad Entry: 2");
  });

  test("rows are stored as they happen", async (db) => {
    const { sizes, spying } = recordingSizes(db, stubLlm().llm);
    await runSimCall({ db, llm: spying, actionId: "action", plan: SEED_PLAN });
    expect(sizes.slice(0, 3)).toEqual([1, 2, 3]);
    expect(sizes.at(-1)).toBeGreaterThan(20);
  });

  test("a model asking to cancel an alarm line is refused by code, in any format", async (db) => {
    const asks = [ALARM_LINES[0]!, `+1 ${ALARM_LINES[1]!}`];
    const { llm, inputs } = stubLlm({
      nextMove: (allowed) => (allowed.includes("cancel_line") && asks.length ? { move: "cancel_line", target: asks.shift()! } : null),
    });
    await runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN });
    const { rows } = await transcript(db);

    expect(rows.filter((r) => r.kind === "refused")).toMatchObject([
      { role: "system", content: `Refused by code: alarm line ${ALARM_LINES[0]}, not requested.` },
      { role: "system", content: `Refused by code: alarm line ${ALARM_LINES[1]}, not requested.` },
    ]);
    for (const alarm of ALARM_LINES) {
      expect(said(rows, "agent").join(" ")).not.toContain(alarm);
      for (const { kind, input } of inputs) if (kind === "rep") expect(input.prompt).not.toContain(alarm);
    }
    expect(said(rows, "agent").filter((l) => l.startsWith("Please cancel"))).toHaveLength(7);
  });

  test("a spelled-out alarm number, or a line not on the list, is not spoken", async (db) => {
    const asks = ["four one five five five five zero one zero three", "(415) 555-0101"];
    const { llm } = stubLlm({
      nextMove: (allowed) => (allowed.includes("cancel_line") && asks.length ? { move: "cancel_line", target: asks.shift()! } : null),
    });
    await runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN });
    const { rows } = await transcript(db);
    expect(rows.filter((r) => r.kind === "refused")).toHaveLength(2);
    expect(said(rows, "agent").join(" ")).not.toContain("four one five");
    expect(said(rows, "agent").join(" ")).not.toContain("555-0101");
  });

  test("a promo account not on the list is refused by code", async (db) => {
    const asks = ["BC-7001"];
    const { llm } = stubLlm({
      nextMove: (allowed) => (allowed.includes("restore_promo") && asks.length ? { move: "restore_promo", target: asks.shift()! } : null),
    });
    await runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN });
    const { rows } = await transcript(db);
    expect(rows.filter((r) => r.kind === "refused")).toHaveLength(1);
    expect(said(rows, "agent").join(" ")).not.toContain("account BC-7001");
  });

  test("a plan holding an alarm line throws before any call exists", async (db) => {
    const { llm, inputs } = stubLlm();
    const plan = { ...SEED_PLAN, cancelLines: [...SEED_PLAN.cancelLines, ALARM_LINES[0]!] };
    await expect(runSimCall({ db, llm, actionId: "action", plan })).rejects.toThrow(/alarm/);
    expect(await db.select().from(calls)).toEqual([]);
    expect(inputs).toEqual([]);
  });

  test("a sim refusal is said by code and stays out of the read-back", async (db) => {
    const line = SEED_PLAN.cancelLines[0]!;
    const promo = SEED_PLAN.promoAccounts[0]!;
    await runSimCall({ db, llm: stubLlm().llm, actionId: "action", plan: SEED_PLAN, refuse: [line, promo] });
    const { rows } = await transcript(db);
    const provider = said(rows, "provider");

    expect(provider.filter((l) => l === SIM_REFUSAL_LINE)).toHaveLength(2);
    expect(provider.filter((l) => l === REP_LINES.cancel)).toHaveLength(6);
    expect(provider.filter((l) => l === REP_LINES.promo)).toHaveLength(2);
    const readBack = said(rows, "agent").find((l) => l.startsWith("To confirm"))!;
    expect(readBack).not.toContain(line);
    expect(readBack).not.toContain(promo);
    expect(readBack).toContain(SEED_PLAN.cancelLines[1]!);
  });

  test("a rep reply that is not a yes stays out of the read-back", async (db) => {
    const line = SEED_PLAN.cancelLines[0]!;
    const { llm } = stubLlm({
      rep: (input) => (input.prompt.split("\n").at(-1)!.includes(`line ${line}`) ? { lines: [REP_LINES.other], endCall: false } : repAnswer(input.prompt)),
    });
    await runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN });
    expect(said((await transcript(db)).rows, "agent").find((l) => l.startsWith("To confirm"))).not.toContain(line);
  });

  test("a failed call closes with its rows kept", async (db) => {
    const { llm } = stubLlm({
      rep: (input) => {
        if (input.prompt.includes("Please cancel")) throw new Error("model down");
        return repAnswer(input.prompt);
      },
    });
    await expect(runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN })).rejects.toThrow("model down");
    const { call, rows } = await transcript(db);
    expect(call.endedAt).toBeInstanceOf(Date);
    expect(said(rows, "agent")).toContain(`Please cancel phone line ${SEED_PLAN.cancelLines[0]} on account BT-7001.`);
  });

  test("a rep hanging up before the goodbye was spoken fails the call", async (db) => {
    const { llm } = stubLlm({
      rep: (input) => (input.prompt.split("\n").at(-1)!.startsWith("Caller: Let me repeat") ? { lines: [REP_LINES.confirm], endCall: true } : repAnswer(input.prompt)),
    });
    await expect(runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN })).rejects.toThrow(/early/);
    const { call, rows } = await transcript(db);
    expect(call.endedAt).toBeInstanceOf(Date);
    expect(said(rows, "agent")).not.toContain("That's everything, thank you. Goodbye.");
  });

  test("an off-script rep reply is rejected by the schema, closing the call with prior rows and no invalid speech", async (db) => {
    const offScript = "Sure, I also cancelled your alarm lines.";
    // The real Llm with only the SDK stream faked, so the rep's real schema does the rejecting.
    const query = async function* () {
      yield { type: "system", subtype: "init", apiKeySource: "none", tools: [], agents: [], mcp_servers: [] };
      yield { type: "result", subtype: "success", is_error: false, result: "", structured_output: { lines: [offScript], endCall: false } };
    } as unknown as Query;
    const real = createLlm(query, async () => {});
    const { llm: stub } = stubLlm();
    const llm: Llm = {
      structured: <T>(input: LlmInput, schema: JsonSchema) =>
        input.prompt.split("\n").at(-1)!.startsWith("Caller: The account number is") ? real.structured<T>(input, schema) : stub.structured<T>(input, schema),
    };

    await expect(runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN })).rejects.toThrow(/does not match the schema/);
    const { call, rows } = await transcript(db);
    expect(call.endedAt).toBeInstanceOf(Date);
    expect(rows.map((r) => r.content)).toEqual([DISCLOSURE_LINE, MENU_LINE, "2", REP_LINES.greeting, "The account number is BT-7001."]);
  });

  test("a looping model stops at the turn cap", async (db) => {
    const { llm } = stubLlm({ nextMove: () => ({ move: "goodbye", target: "" }) });
    await expect(runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN })).rejects.toThrow(/did not finish/);
    expect((await transcript(db)).call.endedAt).toBeInstanceOf(Date);
  });

  test("a silent rep fails the call", async (db) => {
    const { llm } = stubLlm({ rep: () => ({ lines: [], endCall: false }) });
    await expect(runSimCall({ db, llm, actionId: "action", plan: SEED_PLAN })).rejects.toThrow(/said nothing/);
  });

  test("a line not on file throws before any call exists", async (db) => {
    const { llm } = stubLlm();
    await expect(runSimCall({ db, llm, actionId: "action", plan: { ...SEED_PLAN, cancelLines: ["(999) 555-0000"] } })).rejects.toThrow(/not on file/);
    expect(await db.select().from(calls)).toEqual([]);
  });

  it("the seed plan is seven lines and three promos, with no alarm line", () => {
    expect(SEED_PLAN.cancelLines).toHaveLength(7);
    expect(SEED_PLAN.promoAccounts).toEqual(["BC-7002", "BC-7008", "BC-7012"]);
    expect(SEED_PLAN.cancelLines.some((l) => ALARM_LINES.includes(l))).toBe(false);
  });
});
