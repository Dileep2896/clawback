import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { createLlm, type Query } from "./llm.ts";

const SCHEMA = { type: "object", properties: { total: { type: "integer" } }, required: ["total"] };
const INIT = { type: "system", subtype: "init", apiKeySource: "none", tools: [], agents: [] };

const llmWith = (messages: unknown[], thenThrow = "") => {
  const query: Query = async function* () {
    yield* messages as SDKMessage[];
    if (thenThrow) throw new Error(thenThrow);
  };
  return createLlm(query);
};
const success = (structured_output: unknown) => ({ type: "result", subtype: "success", is_error: false, result: "", structured_output });

describe("Llm.structured", () => {
  it("returns JSON that matches the schema", async () => {
    await expect(llmWith([INIT, success({ total: 5 })]).structured({ prompt: "x" }, SCHEMA)).resolves.toEqual({ total: 5 });
  });

  it("returns the validated value, with defaults filled in, and keeps properties the schema allows", async () => {
    const withDefault = { type: "object", properties: { total: { type: "integer", default: 5 } }, required: ["total"] };
    const llm = llmWith([INIT, success({ note: "kept" })]);
    await expect(llm.structured({ prompt: "x" }, withDefault)).resolves.toEqual({ total: 5, note: "kept" });
  });

  it.each([
    ["output that breaks the schema", [INIT, success({ total: "five" })], /does not match/],
    ["a success with no structured output", [INIT, success(undefined)], /no structured output/],
    ["is_error on a success subtype", [INIT, { ...success({ total: 5 }), is_error: true, result: "Invalid API key" }], /Invalid API key/],
    ["the SDK giving up", [INIT, { type: "result", subtype: "error_max_structured_output_retries", is_error: true, errors: [] }], /retries/],
    ["no result", [INIT], /no structured output/],
    ["a key instead of the login", [{ ...INIT, apiKeySource: "ANTHROPIC_API_KEY" }, success({ total: 5 })], /Refusing to run/],
    ["an account connector", [{ ...INIT, tools: ["mcp__claude_ai_Gmail__send_message"] }, success({ total: 5 })], /Refusing to run/],
    ["a plan rate limit", [INIT, { type: "rate_limit_event", rate_limit_info: { status: "rejected" } }, success({ total: 5 })], /rate limit/],
  ])("throws on %s", async (_name, messages, error) => {
    await expect(llmWith(messages).structured({ prompt: "x" }, SCHEMA)).rejects.toThrow(error);
  });

  it("throws when the SDK throws", async () => {
    await expect(llmWith([INIT], "boom").structured({ prompt: "x" }, SCHEMA)).rejects.toThrow(/boom/);
  });
});
