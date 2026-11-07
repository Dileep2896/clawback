// Parses data/bills/*.pdf into the committed data/parsed/. Resumes from the cache, so rerunning after a stop is safe.
// pnpm exec tsx --env-file-if-exists=.env scripts/parse-bills.ts [--limit N]
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { createParseCache, type CachedParse } from "@bill-fighter/agents/parse-cache";
import { getPlatform } from "@bill-fighter/platform/factory";

const BILLS_DIR = "data/bills";
const PARSED_DIR = "data/parsed";
// Other lanes share this Claude login.
const CONCURRENCY = 3;

const { values } = parseArgs({ options: { limit: { type: "string" } } });
const all = readdirSync(BILLS_DIR).filter((file) => file.endsWith(".pdf")).sort();
if (all.length === 0) throw new Error(`No PDFs in ${BILLS_DIR}. Generate the seed and render the bills first.`);

// Evenly spaced, so a pilot covers every provider rather than one store's bills.
const limit = values.limit ? Number(values.limit) : all.length;
if (!Number.isInteger(limit) || limit < 1) throw new Error(`Bad --limit: ${values.limit}`);
const step = all.length / Math.min(limit, all.length);
const files = Array.from({ length: Math.min(limit, all.length) }, (_, i) => all[Math.floor(i * step)]!);

const cache = createParseCache({ dir: PARSED_DIR, llm: await getPlatform().llm() });
const results: (CachedParse & { cached: boolean })[] = [];
let next = 0;
let stopped: unknown;
const started = Date.now();

async function worker() {
  while (next < files.length && !stopped) {
    const file = files[next++]!;
    const source = basename(file, ".pdf");
    try {
      const result = await cache.parse(readFileSync(join(BILLS_DIR, file)), source);
      results.push(result);
      console.info(`${results.length}/${files.length} ${source}: ${result.cached ? "cached" : `${result.status}, ${result.attempts} attempt(s), $${result.costUsd.toFixed(4)}`}`);
    } catch (error) {
      stopped ??= error;
      console.error(`Stopping at ${source}: ${String(error)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const fresh = results.filter((r) => !r.cached);
const review = results.filter((r) => r.status === "needs_review");
for (const r of review) console.warn(`NEEDS REVIEW ${r.source}: ${r.problems.join("; ")}`);
console.info(
  [
    `Bills: ${results.length} of ${files.length} (${fresh.length} parsed now, ${results.length - fresh.length} cached, ${review.length} needs review, ${fresh.filter((r) => r.attempts > 1).length} needed the image retry)`,
    `Wall time: ${((Date.now() - started) / 1000).toFixed(1)}s at concurrency ${CONCURRENCY}`,
    `Estimated cost: $${fresh.reduce((sum, r) => sum + r.costUsd, 0).toFixed(4)} (an SDK estimate, not a bill, and excludes any rejected call)`,
  ].join("\n"),
);
if (stopped) process.exit(1);
