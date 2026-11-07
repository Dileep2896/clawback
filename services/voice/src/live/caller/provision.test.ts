import { describe, expect, it } from "vitest";
import { AGENT_NAME, callerAgent, callerLlm } from "./agent.ts";
import { provisionCaller } from "./provision.ts";
import type { Retell } from "./retell.ts";

type Json = Record<string, unknown>;

// Holds what was saved, and reads it back with whatever changes a test asks for.
function stub(options: { existing?: boolean; agentReadBack?: Json; llmReadBack?: Json } = {}) {
  const log: string[] = [];
  let llm: Json = {};
  let agent: Json = options.existing ? { agent_name: AGENT_NAME, agent_id: "a1", response_engine: { type: "retell-llm", llm_id: "l1" } } : {};
  const retell: Retell = async (method, path, body) => {
    log.push(`${method} ${path}`);
    // Summaries, as Retell's list gives them: no response_engine.
    if (path === "/v2/list-agents") return { items: options.existing ? [{ agent_name: "other", agent_id: "x" }, { agent_name: AGENT_NAME, agent_id: "a1" }] : [] };
    if (path === "/create-retell-llm" || path.startsWith("/update-retell-llm/")) return (llm = { ...(body as Json), llm_id: "l1" });
    if (path === "/create-agent" || path.startsWith("/update-agent/")) return (agent = { ...(body as Json), agent_id: "a1", version: 0 });
    if (path.startsWith("/get-retell-llm/")) return { ...llm, ...options.llmReadBack };
    if (path.startsWith("/get-agent/")) return { ...agent, ...options.agentReadBack };
    throw new Error(`Unexpected ${method} ${path}`);
  };
  return { retell, log };
}

// Answers the list from these pages in order, and everything else as the plain stub does.
function paged(pages: Json[]) {
  const { retell: inner, log } = stub({ existing: true });
  let page = 0;
  const retell: Retell = async (method, path, body) => {
    if (!path.startsWith("/v2/list-agents")) return inner(method, path, body);
    log.push(`${method} ${path}`);
    return pages[page++];
  };
  return { retell, log };
}

const other = { agent_name: "other", agent_id: "x" };

describe("the agent list", () => {
  it("finds a caller on a later page and updates it, passing the key in the query", async () => {
    const { retell, log } = paged([
      { items: [other], has_more: true, pagination_key: "next/1" },
      { items: [{ agent_name: AGENT_NAME, agent_id: "a1" }], has_more: false },
    ]);
    await provisionCaller(retell);
    expect(log.slice(0, 2)).toEqual(["POST /v2/list-agents", "POST /v2/list-agents?pagination_key=next%2F1"]);
    expect(log).toContain("PATCH /update-agent/a1");
    expect(log).not.toContain("POST /create-agent");
  });

  it("creates the caller only after reading every page", async () => {
    const { retell, log } = paged([
      { items: [other], has_more: true, pagination_key: "p2" },
      { items: [other], has_more: false },
    ]);
    await provisionCaller(retell);
    expect(log.filter((entry) => entry.includes("list-agents"))).toHaveLength(2);
    expect(log).toContain("POST /create-agent");
  });

  it.each([
    ["no key", [{ items: [other], has_more: true }]],
    [
      "a repeated key",
      [
        { items: [other], has_more: true, pagination_key: "p2" },
        { items: [other], has_more: true, pagination_key: "p2" },
      ],
    ],
  ])("creates nothing when more pages are promised with %s", async (_, pages) => {
    const { retell, log } = paged(pages);
    await expect(provisionCaller(retell)).rejects.toThrow("says it has more");
    expect(log.filter((entry) => !entry.includes("list-agents"))).toEqual([]);
  });
});

describe("provisionCaller", () => {
  it("creates the LLM and agent, and proves them from a read-back", async () => {
    const { retell, log } = stub();
    await expect(provisionCaller(retell)).resolves.toEqual({ agentId: "a1", agentVersion: 0, llmId: "l1" });
    expect(log).toEqual(["POST /v2/list-agents", "POST /create-retell-llm", "POST /create-agent", "GET /get-retell-llm/l1", "GET /get-agent/a1"]);
  });

  it("updates the existing one on a re-run, rather than making another", async () => {
    const { retell, log } = stub({ existing: true });
    await provisionCaller(retell);
    expect(log).toEqual(["POST /v2/list-agents", "GET /get-agent/a1", "PATCH /update-retell-llm/l1", "PATCH /update-agent/a1", "GET /get-retell-llm/l1", "GET /get-agent/a1"]);
  });

  it("returns the version the read-back proved, not an assumed one", async () => {
    await expect(provisionCaller(stub({ existing: true, agentReadBack: { version: 7 } }).retell)).resolves.toMatchObject({ agentVersion: 7 });
  });

  it("never places a call", async () => {
    const { retell, log } = stub();
    await provisionCaller(retell);
    expect(log.filter((entry) => entry.includes("call"))).toEqual([]);
  });

  it.each([
    ["a changed disclosure", { llmReadBack: { begin_message: "Hello" } }, "begin_message"],
    ["an extra tool", { llmReadBack: { general_tools: [...callerLlm().general_tools, { type: "transfer_call", name: "t" }] } }, "general_tools"],
    ["a longer call limit", { agentReadBack: { max_call_duration_ms: 3_600_000 } }, "max_call_duration_ms"],
    ["an interruptible agent", { agentReadBack: { interruption_sensitivity: 1 } }, "interruption_sensitivity"],
    ["voicemail handling", { agentReadBack: { voicemail_option: { action: { type: "hangup" } } } }, "voicemail"],
    ["IVR handling", { agentReadBack: { ivr_option: { action: { type: "hangup" } } } }, "IVR"],
    ["no version", { agentReadBack: { version: undefined } }, "no usable version"],
    ["a version that is not a number", { agentReadBack: { version: "latest" } }, "no usable version"],
  ])("fails loudly on %s in the read-back", async (_, options, expected) => {
    await expect(provisionCaller(stub(options).retell)).rejects.toThrow(expected);
  });

  it("accepts a read-back that leaves out the nulls and adds its own fields, as the spike's did", async () => {
    const agentReadBack = { voicemail_option: undefined, ivr_option: undefined, version: 0, ...callerAgent("l1") };
    await expect(provisionCaller(stub({ agentReadBack }).retell)).resolves.toMatchObject({ agentId: "a1" });
  });
});
