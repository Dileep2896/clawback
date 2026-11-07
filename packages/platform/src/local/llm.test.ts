import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { describe, expect, it } from "vitest";
import { z } from "zod";
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

  it.each([
    ["minItems with no items", { type: "array", minItems: 1 }, []],
    ["minimum", { type: "number", minimum: 1 }, 0],
    ["pattern", { type: "string", pattern: "^a" }, "b"],
    ["format", { type: "string", format: "date" }, "not a date"],
    ["uniqueItems", { type: "array", uniqueItems: true }, [1, 1]],
    ["minProperties", { type: "object", minProperties: 1 }, {}],
  ])("enforces %s", async (_name, lines, value) => {
    const schema = { type: "object", properties: { lines }, required: ["lines"] };
    await expect(llmWith([INIT, success({ lines: value })]).structured({ prompt: "x" }, schema)).rejects.toThrow(/does not match/);
  });

  it("refuses a keyword it cannot enforce, before calling the model", async () => {
    const query: Query = async function* () {
      throw new Error("the model was called");
    };
    await expect(createLlm(query).structured({ prompt: "x" }, { type: "object", notAKeyword: 1 })).rejects.toThrow(/notAKeyword/);
  });

  it("accepts the schema Zod emits for ParsedBill, the planned caller", async () => {
    const schema = z.toJSONSchema(ParsedBill) as Record<string, unknown>;
    await expect(llmWith([INIT, success({})]).structured({ prompt: "x" }, schema)).rejects.toThrow(/does not match/);
  });

  it("throws when the SDK throws", async () => {
    await expect(llmWith([INIT], "boom").structured({ prompt: "x" }, SCHEMA)).rejects.toThrow(/boom/);
  });
});
