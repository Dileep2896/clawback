import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PARSED_BILL_SCHEMA } from "@bill-fighter/core/parser/prompt";
import { createLlm, type Query } from "@bill-fighter/platform/local/llm";
import type { LlmInput } from "@bill-fighter/platform/types";
import type { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createParseCache, readParsedDir, SCHEMA_HASH } from "./parse-cache.ts";

const pdfWith = (text: string) =>
  Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${text.length + 31}>>stream
BT /F1 12 Tf 10 50 Td (${text}) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`);
const PDF = pdfWith("Hello bill");

const GOOD: ParsedBill = {
  accountNumber: "A-1",
  serviceAddress: null,
  providerName: "Provider",
  serviceType: "internet",
  meterNumber: null,
  multiplier: null,
  rateSchedule: null,
  planCode: "P1",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  kwhByTouPeriod: [],
  maxKw: null,
  lineItems: [{ description: "Internet", quantity: 1, unit: "month", rate: 50, amountCents: 5000, lineType: "internet" }],
  totalCents: 5000,
};

const llmReturning = (output: unknown, costUsd = 0.02) => ({
  structured: vi.fn(async (input: LlmInput) => {
    input.onCost?.(costUsd);
    return output;
  }) as never,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "parse-cache-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createParseCache", () => {
  it("makes no LLM call on the second parse of the same PDF, and says it was cached", async () => {
    const llm = llmReturning(GOOD);
    const cache = createParseCache({ dir, llm });
    expect(await cache.parse(PDF, "bill-1")).toMatchObject({ cached: false, status: "parsed", bill: GOOD, source: "bill-1", costUsd: 0.02 });
    expect(await cache.parse(PDF, "bill-1")).toMatchObject({ cached: true, status: "parsed", bill: GOOD, source: "bill-1" });
    expect(llm.structured).toHaveBeenCalledOnce();
  });

  it("serves a hit from a fresh process with no LLM at all", async () => {
    await createParseCache({ dir, llm: llmReturning(GOOD) }).parse(PDF, "bill-1");
    expect(await createParseCache({ dir }).parse(PDF, "bill-1")).toMatchObject({ cached: true, bill: GOOD });
  });

  it("fails visibly on a miss with no LLM, naming the bill", async () => {
    await expect(createParseCache({ dir }).parse(PDF, "bill-1")).rejects.toThrow(/No cached parse for bill-1/);
  });

  it("misses when the bytes change", async () => {
    const llm = llmReturning(GOOD);
    const cache = createParseCache({ dir, llm });
    await cache.parse(PDF, "bill-1");
    await cache.parse(pdfWith("Other bill"), "bill-2");
    expect(llm.structured).toHaveBeenCalledTimes(2);
  });

  it("keys the file on the sha256 and the schema hash, which comes from the schema", async () => {
    await createParseCache({ dir, llm: llmReturning(GOOD) }).parse(PDF, "bill-1");
    expect(readdirSync(dir)).toEqual([expect.stringMatching(new RegExp(`^[0-9a-f]{64}\\.${SCHEMA_HASH}\\.json$`))]);
    expect(PARSED_BILL_SCHEMA).toHaveProperty("properties.totalCents");
  });

  it("caches needs_review, so a bill that failed twice is not paid for again", async () => {
    const llm = llmReturning({ ...GOOD, totalCents: 1 });
    const cache = createParseCache({ dir, llm });
    expect(await cache.parse(PDF, "bill-1")).toMatchObject({ status: "needs_review", attempts: 2, cached: false, costUsd: 0.04 });
    expect(await cache.parse(PDF, "bill-1")).toMatchObject({ status: "needs_review", cached: true });
    expect(llm.structured).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when the LLM rejects, so a rate limit is retried on the next run", async () => {
    const llm = { structured: vi.fn().mockRejectedValue(new Error("Claude plan rate limit reached")) as never };
    await expect(createParseCache({ dir, llm }).parse(PDF, "bill-1")).rejects.toThrow(/rate limit/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("throws on a corrupt entry rather than spending on a reparse", async () => {
    const llm = llmReturning(GOOD);
    const cache = createParseCache({ dir, llm });
    await cache.parse(PDF, "bill-1");
    writeFileSync(join(dir, readdirSync(dir)[0]!), "{ not json");
    await expect(cache.parse(PDF, "bill-1")).rejects.toThrow(/Corrupt parse cache entry/);
    expect(llm.structured).toHaveBeenCalledOnce();
  });

  it("leaves no temp file behind, and readParsedDir returns the entries", async () => {
    await createParseCache({ dir, llm: llmReturning(GOOD) }).parse(PDF, "bill-1");
    expect(readdirSync(dir).some((file) => file.endsWith(".tmp"))).toBe(false);
    expect(readParsedDir(dir).map((entry) => entry.source)).toEqual(["bill-1"]);
    expect(existsSync(dir)).toBe(true);
  });
});

describe("readParsedDir with more than one schema version", () => {
  const OLD_HASH = "00000000";
  const writeCurrent = async () => {
    await createParseCache({ dir, llm: llmReturning(GOOD) }).parse(PDF, "bill-1");
    const file = readdirSync(dir)[0]!;
    return { file, sha: file.split(".")[0]!, text: readFileSync(join(dir, file), "utf8") };
  };

  it("reads only the current version, skipping old entries whether or not they still parse", async () => {
    const { sha, text } = await writeCurrent();
    writeFileSync(join(dir, `${sha}.${OLD_HASH}.json`), text.replace(SCHEMA_HASH, OLD_HASH));
    writeFileSync(join(dir, `${"a".repeat(64)}.${OLD_HASH}.json`), '{ "shape": "from an old schema" }');
    expect(readParsedDir(dir).map((entry) => entry.schemaHash)).toEqual([SCHEMA_HASH]);
  });

  it("throws when an entry's schema hash disagrees with its file name", async () => {
    const { file, text } = await writeCurrent();
    writeFileSync(join(dir, file), text.replace(SCHEMA_HASH, OLD_HASH));
    expect(() => readParsedDir(dir)).toThrow(/metadata disagrees/);
  });

  it("throws when an entry's PDF hash disagrees with its file name", async () => {
    const { text } = await writeCurrent();
    writeFileSync(join(dir, `${"a".repeat(64)}.${SCHEMA_HASH}.json`), text);
    expect(() => readParsedDir(dir)).toThrow(/metadata disagrees/);
  });
});

describe("parsing through the real Llm adapter with a stubbed SDK", () => {
  const INIT = { type: "system", subtype: "init", apiKeySource: "none", tools: [], agents: [], mcp_servers: [] };
  const success = (structured_output: unknown) => ({ type: "result", subtype: "success", is_error: false, result: "", structured_output, total_cost_usd: 0.02 });
  const SDK_GAVE_UP = { type: "result", subtype: "error_max_structured_output_retries", is_error: true, errors: ["gave up on the schema"], total_cost_usd: 0.02 };
  const MALFORMED = success({ nonsense: true });

  const sdk = (...runs: unknown[][]) => {
    const prompts: unknown[] = [];
    const query = async function* ({ prompt }: { prompt: unknown }) {
      prompts.push(prompt);
      yield* runs[prompts.length - 1]!;
    };
    return { query: query as unknown as Query, prompts };
  };

  it.each([
    ["output our schema check rejects", MALFORMED],
    ["output the SDK's schema check gave up on", SDK_GAVE_UP],
    ["a result with no output", success(undefined)],
  ])("takes the image retry after %s, and accepts a retry that validates", async (_name, bad) => {
    const { query, prompts } = sdk([INIT, bad], [INIT, success(GOOD)]);
    const result = await createParseCache({ dir, llm: createLlm(query, async () => {}) }).parse(PDF, "bill-1");
    expect(result).toMatchObject({ status: "parsed", bill: GOOD, attempts: 2, costUsd: 0.04 });
    expect(typeof prompts[0]).toBe("string");
    expect(typeof prompts[1]).toBe("object"); // the image prompt is a message stream
  });

  it("marks needs_review after two malformed outputs, and caches it", async () => {
    const { query, prompts } = sdk([INIT, MALFORMED], [INIT, SDK_GAVE_UP]);
    const cache = createParseCache({ dir, llm: createLlm(query, async () => {}) });
    expect(await cache.parse(PDF, "bill-1")).toMatchObject({ status: "needs_review", bill: null, problems: [expect.stringMatching(/gave up on the schema/)], attempts: 2, cached: false });
    expect(await cache.parse(PDF, "bill-1")).toMatchObject({ status: "needs_review", cached: true });
    expect(prompts).toHaveLength(2);
  });

  it.each([
    ["a rejected rate limit", [INIT, { type: "rate_limit_event", rate_limit_info: { status: "rejected" } }, success(GOOD)], /rate limit/],
    ["a rate limit in a run that also gave up on the schema", [INIT, { type: "rate_limit_event", rate_limit_info: { status: "rejected" } }, SDK_GAVE_UP], /rate limit/],
    ["an auth failure in a run that also gave up on the schema", [INIT, { type: "auth_status", error: "Not logged in" }, SDK_GAVE_UP], /Not logged in/],
    ["a usage limit error result", [INIT, { type: "result", subtype: "error_during_execution", is_error: true, errors: ["usage limit reached"] }], /usage limit/],
    ["an auth failure reported as success", [INIT, { ...success(GOOD), is_error: true, result: "Please run /login" }], /login/],
  ])("throws straight away on %s, with no retry and nothing cached", async (_name, run, error) => {
    const { query, prompts } = sdk(run);
    await expect(createParseCache({ dir, llm: createLlm(query, async () => {}) }).parse(PDF, "bill-1")).rejects.toThrow(error);
    expect(prompts).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("rethrows an SDK exception that follows a give-up result, with no retry and nothing cached", async () => {
    let calls = 0;
    const query = async function* () {
      calls++;
      yield* [INIT, SDK_GAVE_UP];
      throw new Error("transport down");
    };
    await expect(createParseCache({ dir, llm: createLlm(query as unknown as Query, async () => {}) }).parse(PDF, "bill-1")).rejects.toThrow(/transport down/);
    expect(calls).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("throws straight away when the login check refuses, before calling the model", async () => {
    const { query, prompts } = sdk([INIT, success(GOOD)]);
    const refuse = async () => {
      throw new Error("Refusing to run: not the login");
    };
    await expect(createParseCache({ dir, llm: createLlm(query, refuse) }).parse(PDF, "bill-1")).rejects.toThrow(/Refusing to run/);
    expect(prompts).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });
});
