// One bill for a fictional second business, so a new sign-up has a PDF of its own to upload: every PDF in data/bills is the
// demo customer's, and the one-owner rule holds those for review. Renders data/sample-bills/, then parses it once with the
// existing parser into data/parsed-samples/, both committed, so uploads read it from cache for free. Never data/parsed: that is the audit's input.
// Run once: pnpm exec tsx --env-file-if-exists=.env scripts/make-sample-bill.ts (one Claude parse, a few cents, on a cache miss only)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createParseCache } from "@bill-fighter/agents/parse-cache";
import { renderBillPdf } from "@bill-fighter/db/seed/bill-pdf";
import { generateSeed } from "@bill-fighter/db/seed/generate";
import { getPlatform } from "@bill-fighter/platform/factory";
import { chromium } from "playwright";

const ROOT = new URL("../", import.meta.url);
export const SAMPLE_PDF = fileURLToPath(new URL("data/sample-bills/mission-dumplings-baycurrent-2026-09.pdf", ROOT));
export const SAMPLE_PARSED_DIR = fileURLToPath(new URL("data/parsed-samples/", ROOT));
export const SAMPLE_SOURCE = "sample-mission-dumplings-baycurrent-2026-09";
// Not a seed account number, so the sample can never match the demo customer.
export const SAMPLE_ACCOUNT = "BE-8801";

const seed = generateSeed();
// A real seed bill's numbers, so the sample is internally consistent and passes the parser's checks.
const base = seed.bills.find((b) => b.id === "fremont-1-electric-2026-09");
const baseAccount = seed.accounts.find((a) => a.id === base?.accountId);
if (!base || !baseAccount) throw new Error("The seed has no fremont-1-electric-2026-09 bill to base the sample on");

const customer = { id: "mission-dumplings", name: "Mission Dumplings", contactName: "Sam Lee", contactEmail: "sam@missiondumplings.example", contactPhone: "(415) 555-0199", savingsSharePct: 30 };
const location = { id: "mission-1", customerId: customer.id, name: "Mission St", address: "2400 Mission St", city: "San Francisco" };
const account = { ...baseAccount, id: "mission-1-electric", locationId: location.id, accountNumber: SAMPLE_ACCOUNT, meterNumber: "1009988" };
const bill = { ...base, id: SAMPLE_SOURCE, accountId: account.id, meterNumber: account.meterNumber, pdfPath: null };

const browser = await chromium.launch();
try {
  mkdirSync(new URL("data/sample-bills/", ROOT), { recursive: true });
  writeFileSync(SAMPLE_PDF, await renderBillPdf(browser, { bill, account, location, customer }));
} finally {
  await browser.close();
}

const cache = createParseCache({ dir: SAMPLE_PARSED_DIR, llm: await getPlatform().llm() });
const result = await cache.parse(readFileSync(SAMPLE_PDF), SAMPLE_SOURCE);
console.info(`${SAMPLE_PDF}: ${result.cached ? "cached" : `${result.status}, ${result.attempts} attempt(s), $${result.costUsd.toFixed(4)}`}`);
if (result.status !== "parsed") throw new Error(`The sample did not parse cleanly: ${result.problems.join("; ")}`);
if (result.bill?.accountNumber !== SAMPLE_ACCOUNT) throw new Error(`Parsed account ${result.bill?.accountNumber}, expected ${SAMPLE_ACCOUNT}`);
