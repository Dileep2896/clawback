import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CORE = new URL("../../", import.meta.url);
const SRC = new URL("src/", CORE);

// An allowlist, so it also catches network clients and LLM SDKs nobody thought to name.
const ALLOWED = /^(\.{1,2}\/|@bill-fighter\/shared\/|zod$|pdfjs-dist\/|vitest$|node:(fs|os|path|url)$)/;
const ALLOWED_DEPENDENCIES = ["@bill-fighter/shared", "pdfjs-dist", "zod"];

const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;
const specifiers = (code: string) => [...code.matchAll(SPECIFIER)].map((match) => match[1]!);
const disallowed = (code: string) => specifiers(code).filter((name) => !ALLOWED.test(name));

// Skips this file, whose test strings name the very things it bans.
const sources = () =>
  readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith("boundary.test.ts"))
    .map((file) => ({ file, code: readFileSync(new URL(file, SRC), "utf8") }));

describe("packages/core boundary", () => {
  it("catches each import form", () => {
    for (const form of ['import x from "openai";', 'export { x } from "undici";', 'await import("node:https");', 'require("axios");', 'import "@anthropic-ai/sdk";']) {
      expect(disallowed(form)).toHaveLength(1);
    }
  });

  it("imports no network client or LLM SDK", () => {
    const files = sources();
    expect(files.some(({ file }) => file.endsWith("parser/parse-bill.ts"))).toBe(true);
    expect(files.flatMap(({ file, code }) => disallowed(code).map((name) => `${file}: ${name}`))).toEqual([]);
  });

  it("never calls fetch", () => {
    expect(sources().filter(({ code }) => /\bfetch\s*\(/.test(code)).map(({ file }) => file)).toEqual([]);
  });

  it("declares no other dependency", () => {
    const { dependencies } = JSON.parse(readFileSync(new URL("package.json", CORE), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(dependencies).sort()).toEqual(ALLOWED_DEPENDENCIES);
  });
});
