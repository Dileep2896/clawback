import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PARSED_BILL_SCHEMA } from "@bill-fighter/core/parser/prompt";
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
