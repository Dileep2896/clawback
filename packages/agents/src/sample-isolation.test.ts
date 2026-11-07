import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { generateSeed } from "@bill-fighter/db/seed/generate";
import { describe, expect, it } from "vitest";
import { readParsedDir } from "./parse-cache.ts";

const ROOT = new URL("../../../", import.meta.url);
const path = (relative: string) => new URL(relative, ROOT).pathname;
const SAMPLE_PDF = path("data/samples/pge-solar-billing-statement.pdf");
const PARSED_DIR = path("data/parsed");

// As printed on PG&E's sample.
const SAMPLE_ACCOUNT = "1023456789-0";

describe("the PG&E sample stays out of the demo customer", () => {
  it("is absent from the generated seed", () => {
    const seed = JSON.stringify(generateSeed());
    expect(seed).not.toContain(SAMPLE_ACCOUNT);
    expect(seed).not.toContain("pge-solar-billing-statement");
  }, 120_000);

  it("is absent from the committed parsed bills", () => {
    const entries = readParsedDir(PARSED_DIR);
    expect(entries.filter((e) => e.bill?.accountNumber === SAMPLE_ACCOUNT || e.source.includes("pge"))).toEqual([]);
  });

  it("is not referenced by any seed code", () => {
    const seedCode = readdirSync(path("packages/db/src/seed"), { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
    expect(seedCode.length).toBeGreaterThan(0);
    const scripts = readdirSync(path("scripts")).filter((file) => /seed/.test(file));
    const files = [...seedCode.map((file) => path(`packages/db/src/seed/${file}`)), ...scripts.map((file) => path(`scripts/${file}`))];
    expect(files.filter((file) => /data\/samples|parse-sample/.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  // The file is downloaded on demand and gitignored, so pnpm test must not need it.
  it.skipIf(!existsSync(SAMPLE_PDF))("has no entry under its own hash in the committed parsed bills", () => {
    const sha = createHash("sha256").update(readFileSync(SAMPLE_PDF)).digest("hex");
    expect(readParsedDir(PARSED_DIR).filter((e) => e.pdfSha256 === sha)).toEqual([]);
  });
});
