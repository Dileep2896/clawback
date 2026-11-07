import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlm, type Query } from "./llm.ts";

const SCHEMA = { type: "object", properties: { total: { type: "integer" } }, required: ["total"] };
const INIT = { type: "system", subtype: "init", apiKeySource: "none", tools: [], agents: [], mcp_servers: [] };

const llmWith = (messages: unknown[], thenThrow = "") => {
  const query: Query = async function* () {
    yield* messages as SDKMessage[];
    if (thenThrow) throw new Error(thenThrow);
  };
  return createLlm(query, async () => {});
};
const success = (structured_output: unknown) => ({ type: "result", subtype: "success", is_error: false, result: "", structured_output });

describe("Llm.structured", () => {
  it("returns JSON that matches the schema", async () => {
    await expect(llmWith([INIT, success({ total: 5 })]).structured({ prompt: "x" }, SCHEMA)).resolves.toEqual({ total: 5 });
  });

  it("returns the output unchanged, keeping properties the schema allows", async () => {
    await expect(llmWith([INIT, success({ total: 5, note: "kept" })]).structured({ prompt: "x" }, SCHEMA)).resolves.toEqual({ total: 5, note: "kept" });
  });

  it("does not fill defaults, which could break a constraint already checked", async () => {
    const schema = { type: "object", allOf: [{ properties: { total: { maximum: 10 } } }, { properties: { total: { default: 20 } } }] };
    await expect(llmWith([INIT, success({})]).structured({ prompt: "x" }, schema)).resolves.toEqual({});
  });

  it("does not let a default satisfy required", async () => {
    const schema = { type: "object", properties: { total: { type: "integer", default: 5 } }, required: ["total"] };
    await expect(llmWith([INIT, success({})]).structured({ prompt: "x" }, schema)).rejects.toThrow(/does not match/);
  });

  it("refuses before calling the model when the login check fails", async () => {
    const query: Query = async function* () {
      throw new Error("the model was called");
    };
    const refuse = async () => {
      throw new Error("Refusing to run: not the login");
    };
    await expect(createLlm(query, refuse).structured({ prompt: "x" }, SCHEMA)).rejects.toThrow(/Refusing to run/);
  });

  it.each([
    ["output that breaks the schema", [INIT, success({ total: "five" })], /does not match/],
    ["a success with no structured output", [INIT, success(undefined)], /no structured output/],
    ["a later result with no output", [INIT, success({ total: 5 }), success(undefined)], /no structured output/],
    // Which streams count as finished is tested once, on runOutcome. This only proves structured() asks it.
    ["a run runOutcome says did not finish", [INIT, success({ total: 5 }), { type: "auth_status", error: "" }], /no message/],
  ])("throws on %s", async (_name, messages, error) => {
    await expect(llmWith(messages).structured({ prompt: "x" }, SCHEMA)).rejects.toThrow(error);
  });

  it("stops reading the stream at a refused init", async () => {
    let readOn = false;
    const query: Query = async function* () {
      yield { ...INIT, apiKeySource: "ANTHROPIC_API_KEY" } as unknown as SDKMessage;
      readOn = true;
    };
    await expect(createLlm(query, async () => {}).structured({ prompt: "x" }, SCHEMA)).rejects.toThrow(/Refusing to run/);
    expect(readOn).toBe(false);
  });

  it("throws when the SDK throws an empty error after a success", async () => {
    const query: Query = async function* () {
      yield* [INIT, success({ total: 5 })] as SDKMessage[];
      throw new Error("");
    };
    await expect(createLlm(query, async () => {}).structured({ prompt: "x" }, SCHEMA)).rejects.toThrow(/no message/);
  });

  it.each([
    ["at the root", { $async: true, ...SCHEMA }],
    ["with a truthy value", { $async: 1, ...SCHEMA }],
    ["on a nested property", { type: "object", properties: { total: { $async: true, type: "integer" } } }],
    ["behind a $ref", { $ref: "#/$defs/total", $defs: { total: { $async: true, type: "integer" } } }],
  ])("refuses $async %s, before calling the login or the model", async (_name, schema) => {
    const calls: string[] = [];
    const query: Query = async function* () {
      calls.push("query");
    };
    const login = async () => {
      calls.push("login");
    };
    await expect(createLlm(query, login).structured({ prompt: "x" }, schema)).rejects.toThrow(/async/);
    expect(calls).toEqual([]);
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
    await expect(createLlm(query, async () => {}).structured({ prompt: "x" }, { type: "object", notAKeyword: 1 })).rejects.toThrow(/notAKeyword/);
  });

  it("accepts the schema Zod emits for ParsedBill, the planned caller", async () => {
    const schema = z.toJSONSchema(ParsedBill) as Record<string, unknown>;
    await expect(llmWith([INIT, success({})]).structured({ prompt: "x" }, schema)).rejects.toThrow(/does not match/);
  });

  it("throws when the SDK throws", async () => {
    await expect(llmWith([INIT], "boom").structured({ prompt: "x" }, SCHEMA)).rejects.toThrow(/boom/);
  });
});
