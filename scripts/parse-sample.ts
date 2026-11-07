// Parses PG&E's public sample bill, for parser testing only. It is their copyrighted file, so it is downloaded and
// gitignored rather than committed, and it never goes near the demo customer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createParseCache } from "@bill-fighter/agents/parse-cache";
import { getPlatform } from "@bill-fighter/platform/factory";

const SAMPLE_URL = "https://www.pge.com/assets/pge/docs/clean-energy/solar/commercial-business-monthly-statement-sbp.pdf";
const SAMPLE_DIR = "data/samples";
const SAMPLE_PDF = `${SAMPLE_DIR}/pge-solar-billing-statement.pdf`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!existsSync(SAMPLE_PDF)) {
  const response = await fetch(SAMPLE_URL).catch((error: unknown) => fail(`Could not download the sample from ${SAMPLE_URL}: ${String(error)}`));
  if (!response.ok) fail(`Could not download the sample from ${SAMPLE_URL}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-") fail(`${SAMPLE_URL} did not return a PDF`);
  mkdirSync(SAMPLE_DIR, { recursive: true });
  writeFileSync(SAMPLE_PDF, bytes);
}

const started = Date.now();
const cache = createParseCache({ dir: `${SAMPLE_DIR}/parsed`, llm: await getPlatform().llm() });
const result = await cache.parse(readFileSync(SAMPLE_PDF), "pge-solar-billing-statement");

console.info(JSON.stringify(result.bill, null, 2));
console.info(`Status: ${result.status}, ${result.cached ? "cached" : `${result.attempts} attempt(s)`}, ${((Date.now() - started) / 1000).toFixed(1)}s, estimated $${result.costUsd.toFixed(4)} (an SDK estimate, not a bill)`);
for (const line of result.bill?.lineItems ?? []) {
  if (line.lineType === "prior_balance") console.info(`Layout difference: "${line.description}" (${line.amountCents} cents) is carried over from an earlier bill and counts toward the total as printed.`);
}
if (result.status !== "parsed") fail(`The sample failed validation. This is the gap, reported rather than loosened:\n${result.problems.join("\n")}`);
