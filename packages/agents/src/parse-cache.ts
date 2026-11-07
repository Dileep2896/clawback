import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBill, type Extract } from "@bill-fighter/core/parser/parse-bill";
import { PARSED_BILL_SCHEMA } from "@bill-fighter/core/parser/prompt";
import type { Llm } from "@bill-fighter/platform/types";
import { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { z } from "zod";

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

// Derived, so editing the schema cannot reuse stale entries the way a forgotten version constant would.
export const SCHEMA_HASH = sha256(JSON.stringify(PARSED_BILL_SCHEMA)).slice(0, 8);

export const CachedParse = z.strictObject({
  // The bill id for seed bills, which is what lets the audit find entries without the gitignored PDFs.
  source: z.string().min(1),
  pdfSha256: z.string().regex(/^[0-9a-f]{64}$/),
  schemaHash: z.string().min(1),
  status: z.enum(["parsed", "needs_review"]),
  bill: ParsedBill.nullable(),
  problems: z.array(z.string()),
  attempts: z.number().int().positive(),
  // An SDK estimate, not a bill. What the original parse cost, never spent again on a cache hit.
  costUsd: z.number().nonnegative(),
});
export type CachedParse = z.infer<typeof CachedParse>;

// A corrupt entry throws rather than counting as a miss, so it can never cause a surprise LLM call on stage.
function readEntry(path: string): CachedParse | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return CachedParse.parse(JSON.parse(text));
  } catch (cause) {
    throw new Error(`Corrupt parse cache entry ${path}`, { cause });
  }
}

export const readParsedDir = (dir: string): CachedParse[] =>
  readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readEntry(join(dir, file))!);

/** Without an llm, for the stage run, a miss throws instead of spending. */
export function createParseCache({ dir, llm }: { dir: string; llm?: Pick<Llm, "structured"> }) {
  return {
    async parse(pdf: Uint8Array, source: string): Promise<CachedParse & { cached: boolean }> {
      const pdfSha256 = sha256(pdf);
      const path = join(dir, `${pdfSha256}.${SCHEMA_HASH}.json`);
      const hit = readEntry(path);
      if (hit) return { ...hit, cached: true };
      if (!llm) throw new Error(`No cached parse for ${source} (${pdfSha256}). Bills must be parsed ahead of time with scripts/parse-bills.ts.`);

      let costUsd = 0;
      const extract: Extract = (input, jsonSchema) =>
        llm.structured({ ...input, onCost: (usd) => (costUsd += usd) }, jsonSchema);
      const result = await parseBill({ pdf, extract });

      const entry = CachedParse.parse({ source, pdfSha256, schemaHash: SCHEMA_HASH, ...result, costUsd });
      mkdirSync(dir, { recursive: true });
      // Rename is atomic, so a run killed mid-write leaves no half entry to trip over on resume.
      writeFileSync(`${path}.tmp`, `${JSON.stringify(entry, null, 2)}\n`);
      renameSync(`${path}.tmp`, path);
      return { ...entry, cached: false };
    },
  };
}
