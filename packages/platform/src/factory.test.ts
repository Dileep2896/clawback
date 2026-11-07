import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatform, getPlatform } from "./factory.ts";

describe("getPlatform", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws a clear error for an unknown PLATFORM", () => {
    vi.stubEnv("PLATFORM", "bogus");
    expect(() => getPlatform()).toThrow('Unknown PLATFORM "bogus": expected one of local, naive');
  });

  it.each(["local", "naive", ""])("accepts PLATFORM=%j", (name) => {
    vi.stubEnv("PLATFORM", name);
    expect(() => getPlatform()).not.toThrow();
  });
});

describe("createPlatform", () => {
  let src: string;

  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), "platform-factory-"));
    mkdirSync(join(src, "naive"));
  });
  afterEach(() => rmSync(src, { recursive: true }));

  it("loads an adapter's default export from its own file", async () => {
    writeFileSync(join(src, "naive", "agent-runtime.ts"), `export default { from: "agent-runtime" };`);
    expect(await createPlatform("naive", src).agentRuntime()).toEqual({ from: "agent-runtime" });
  });

  it("says a missing adapter is not built yet", async () => {
    await expect(createPlatform("naive", src).mail()).rejects.toThrow(
      'Platform "naive": adapter mail is not built yet (expected naive/mail.ts)',
    );
  });

  it("loads one interface without touching the others", async () => {
    writeFileSync(join(src, "naive", "browser.ts"), `throw new Error("browser loaded");`);
    writeFileSync(join(src, "naive", "board.ts"), `export default { from: "board" };`);
    expect(await createPlatform("naive", src).board()).toEqual({ from: "board" });
  });

  it("does not report a broken adapter as not built", async () => {
    writeFileSync(join(src, "naive", "browser.ts"), `throw new Error("playwright is missing");`);
    await expect(createPlatform("naive", src).browser()).rejects.toThrow("playwright is missing");
  });

  it("rejects an adapter with no default export", async () => {
    writeFileSync(join(src, "naive", "vault.ts"), `export const vault = {};`);
    await expect(createPlatform("naive", src).vault()).rejects.toThrow("naive/vault.ts has no default export");
  });
});
