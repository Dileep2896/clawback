import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Vault } from "@bill-fighter/platform/types";
import { Provider } from "@bill-fighter/shared/fixtures";
import { portalVaultName } from "@bill-fighter/shared/portal";
import { describe, expect, it } from "vitest";
import { readCredentials, verifyLogin } from "../apps/portal/lib/credentials.ts";
import { seedPortalCredentials } from "./seed-portal-credentials.ts";

function memoryVault() {
  const secrets = new Map<string, string>();
  const vault: Vault = {
    async put(name, value) {
      secrets.set(name, value);
    },
    async get(name) {
      return secrets.get(name)!;
    },
  };
  return { vault, secrets };
}

const tempPath = async () => join(await mkdtemp(join(tmpdir(), "portal-seed-")), "nested", "credentials.json");

describe("seedPortalCredentials", () => {
  it("gives every provider a working login from the vault, and keeps plaintext out of the file", async () => {
    const { vault, secrets } = memoryVault();
    const path = await tempPath();
    await seedPortalCredentials(vault, path);

    const file = await readFile(path, "utf8");
    const credentials = (await readCredentials(path))!;
    for (const provider of Provider.options) {
      const username = await vault.get(portalVaultName(provider, "username"));
      const password = await vault.get(portalVaultName(provider, "password"));
      expect(await verifyLogin(credentials, provider, username, password)).toBe(true);
      expect(file).not.toContain(password);
    }
    expect(secrets.size).toBe(Provider.options.length * 2);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("writes no file when the vault refuses, so the two can never disagree silently", async () => {
    const vault: Vault = {
      put: () => Promise.reject(new Error("VAULT_KEY must be base64 of 32 bytes")),
      get: () => Promise.reject(new Error("unused")),
    };
    const path = await tempPath();
    await expect(seedPortalCredentials(vault, path)).rejects.toThrow("VAULT_KEY");
    expect(await readCredentials(path)).toBeNull();
  });

  it("rotates the passwords when run again, leaving the vault and file in step", async () => {
    const { vault } = memoryVault();
    const path = await tempPath();
    await seedPortalCredentials(vault, path);
    const before = await vault.get(portalVaultName("baytel", "password"));
    await seedPortalCredentials(vault, path);
    const after = await vault.get(portalVaultName("baytel", "password"));
    const credentials = (await readCredentials(path))!;
    expect(after).not.toBe(before);
    const username = await vault.get(portalVaultName("baytel", "username"));
    expect(await verifyLogin(credentials, "baytel", username, before)).toBe(false);
    expect(await verifyLogin(credentials, "baytel", username, after)).toBe(true);
  });
});
