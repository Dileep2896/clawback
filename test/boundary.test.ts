import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();

async function isBlocked(code: string, filePath: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.some((m) => m.ruleId === "no-restricted-syntax");
}

const BANNED = [
  "@anthropic-ai/claude-agent-sdk",
  "playwright",
  "playwright-core",
  "@playwright/test",
  "nodemailer",
  "node-cron",
];

const FORMS: [string, (pkg: string) => string][] = [
  ["static import", (p) => `import x from "${p}"; export { x };`],
  ["type import", (p) => `import type { X } from "${p}"; export type { X };`],
  ["subpath import", (p) => `import x from "${p}/sub"; export { x };`],
  ["named re-export", (p) => `export { x } from "${p}";`],
  ["star re-export", (p) => `export * from "${p}";`],
  ["dynamic import", (p) => `export const x = import("${p}");`],
  ["require", (p) => `export const x = require("${p}");`],
  ["import equals", (p) => `import x = require("${p}"); export { x };`],
];

const CORE = "packages/core/src/x.ts";
const EXEMPT = ["scripts/x.ts", "packages/db/src/seed/x.ts", "apps/portal/e2e/x.ts"];

describe("platform SDK import boundary", () => {
  describe.each(BANNED)("%s", (pkg) => {
    it.each(FORMS)("fails lint outside packages/platform: %s", async (_name, form) => {
      expect(await isBlocked(form(pkg), CORE)).toBe(true);
    });

    it("passes inside packages/platform", async () => {
      expect(await isBlocked(FORMS[0]![1](pkg), "packages/platform/src/local/x.ts")).toBe(false);
    });
  });

  it.each(EXEMPT)("allows Playwright, and only Playwright, in %s", async (file) => {
    expect(await isBlocked(`import x from "playwright"; export { x };`, file)).toBe(false);
    expect(await isBlocked(`import x from "@anthropic-ai/claude-agent-sdk"; export { x };`, file)).toBe(true);
    expect(await isBlocked(`import x from "nodemailer"; export { x };`, file)).toBe(true);
  });

  it.each(["apps/portal/app/page.tsx", "apps/portal/lib/x.ts", "packages/db/src/x.ts", "packages/agents/src/x.ts"])(
    "keeps Playwright blocked just outside the exemptions: %s",
    async (file) => {
      expect(await isBlocked(`import x from "playwright"; export { x };`, file)).toBe(true);
    },
  );

  it.each(["./playwright", "@foo/playwright", "playwright-extras", "stripe", "zod"])(
    "does not flag the unrelated module %s",
    async (name) => {
      expect(await isBlocked(`import x from "${name}"; export { x };`, CORE)).toBe(false);
    },
  );
});
