import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVault } from "./vault.ts";

const VAULT_KEY = randomBytes(32).toString("base64");
let dir: string;
let VAULT_PATH: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vault-test-"));
  VAULT_PATH = join(dir, "vault.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("vault", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", randomBytes(16).toString("base64")],
    ["not base64", "x".repeat(44)],
  ])("refuses a %s key", async (_label, key) => {
    await expect(createVault({ VAULT_PATH, VAULT_KEY: key }).put("a", "b")).rejects.toThrow(/openssl rand/);
    await expect(createVault({ VAULT_PATH, VAULT_KEY: key }).get("a")).rejects.toThrow(/openssl rand/);
  });

  it("names a missing secret, and treats a missing file as empty", async () => {
    await expect(createVault({ VAULT_PATH, VAULT_KEY }).get("nope")).rejects.toThrow(/no secret named "nope"/);
  });

  it("does not treat Object.prototype names as secrets", async () => {
    const vault = createVault({ VAULT_PATH, VAULT_KEY });
    await vault.put("a", "b");
    await expect(vault.get("constructor")).rejects.toThrow(/no secret named/);
    await vault.put("__proto__", "kept");
    expect(await vault.get("__proto__")).toBe("kept");
  });

  it("keeps every concurrent put", async () => {
    const vault = createVault({ VAULT_PATH, VAULT_KEY });
    await Promise.all(["a", "b", "c", "d"].map((name) => vault.put(name, `${name}!`)));
    expect(await Promise.all(["a", "b", "c", "d"].map((name) => vault.get(name)))).toEqual(["a!", "b!", "c!", "d!"]);
  });

  it("keeps every concurrent put across vaults on the same path", async () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
    await Promise.all(names.map((name) => createVault({ VAULT_PATH, VAULT_KEY }).put(name, `${name}!`)));
    const vault = createVault({ VAULT_PATH, VAULT_KEY });
    expect(await Promise.all(names.map((name) => vault.get(name)))).toEqual(names.map((name) => `${name}!`));
  });

  it("still writes after a failed put on the same vault", async () => {
    const env: Record<string, string | undefined> = { VAULT_PATH, VAULT_KEY: "bad" };
    const vault = createVault(env);
    await expect(vault.put("a", "1")).rejects.toThrow(/openssl rand/);
    env.VAULT_KEY = VAULT_KEY;
    await vault.put("a", "1");
    expect(await vault.get("a")).toBe("1");
  });
});
