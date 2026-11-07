import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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
  let entry: CachedParse;
  try {
    entry = CachedParse.parse(JSON.parse(text));
  } catch (cause) {
    throw new Error(`Corrupt parse cache entry ${path}`, { cause });
  }
  if (`${entry.pdfSha256}.${entry.schemaHash}.json` !== basename(path)) throw new Error(`Corrupt parse cache entry ${path}: its metadata disagrees with its file name`);
  return entry;
}

// Older schema versions stay on disk after a reparse. Reading them would duplicate bills, or abort on a shape that no longer parses.
export function readParsedDir(dir: string): CachedParse[] {
  const fileBySource = new Map<string, string>();
  return readdirSync(dir)
    .filter((file) => file.endsWith(`.${SCHEMA_HASH}.json`))
    .map((file) => {
      const entry = readEntry(join(dir, file))!;
      const other = fileBySource.get(entry.source);
      // Changed PDF bytes leave the old entry behind, and either one could be the stale bill, so never pick.
      if (other) throw new Error(`Two current parse cache entries for source ${entry.source}: ${other} and ${file}`);
      fileBySource.set(entry.source, file);
      return entry;
    });
}

/** Without an llm, for the stage run, a miss throws instead of spending. */
export function createParseCache({ dir, llm }: { dir: string; llm?: Pick<Llm, "structured"> }) {
  return {
    async parse(pdf: Uint8Array, source: string): Promise<CachedParse & { cached: boolean }> {
      const pdfSha256 = sha256(pdf);
      const path = join(dir, `${pdfSha256}.${SCHEMA_HASH}.json`);
      const hit = readEntry(path);
      // Same bytes under another id: returning the entry would give the caller the wrong bill and evidence line ids.
      if (hit && hit.source !== source) throw new Error(`Parse cache entry ${path} belongs to source ${hit.source}, but source ${source} was requested`);
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
