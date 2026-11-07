import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVault } from "./vault.ts";

const newKey = () => randomBytes(32).toString("base64");

export default async function check() {
  const dir = await mkdtemp(join(tmpdir(), "vault-check-"));
  try {
    const VAULT_PATH = join(dir, "nested", "vault.json");
    const VAULT_KEY = newKey();
    const vault = createVault({ VAULT_PATH, VAULT_KEY });

    await vault.put("portal_password", "hunter2-plaintext");
    assert.equal(await vault.get("portal_password"), "hunter2-plaintext");

    const raw = await readFile(VAULT_PATH, "utf8");
    assert.ok(!raw.includes("hunter2-plaintext"), "the file holds the plaintext secret");
    assert.ok(!raw.includes("portal_password"), "the file holds the secret's name");
    assert.equal((await stat(VAULT_PATH)).mode & 0o077, 0, "the file is readable by other users");

    await assert.rejects(createVault({ VAULT_PATH, VAULT_KEY: newKey() }).get("portal_password"), /wrong VAULT_KEY/);

    const parsed = JSON.parse(raw);
    const flipped = Buffer.from(parsed.data, "base64");
    flipped.writeUInt8(flipped.readUInt8(0) ^ 1, 0);
    await writeFile(VAULT_PATH, JSON.stringify({ ...parsed, data: flipped.toString("base64") }));
    await assert.rejects(vault.get("portal_password"), /damaged file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
