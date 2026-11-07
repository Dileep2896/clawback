import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Vault } from "../types.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ALGORITHM = "aes-256-gcm";
// Base64 of exactly 32 bytes. Buffer.from alone would quietly accept a malformed key.
const KEY = /^[A-Za-z0-9+/]{43}=$/;

function keyFrom(env: Record<string, string | undefined>): Buffer {
  const key = env.VAULT_KEY ?? "";
  if (!KEY.test(key)) {
    throw new Error("VAULT_KEY must be base64 of 32 bytes. Generate one with: openssl rand -base64 32");
  }
  return Buffer.from(key, "base64");
}

function encrypt(secrets: Map<string, string>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(Object.fromEntries(secrets)), "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

function decrypt(file: string, key: Buffer): Map<string, string> {
  try {
    const { iv, tag, data } = JSON.parse(file);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
    return new Map(Object.entries(JSON.parse(plain.toString("utf8")) as Record<string, string>));
  } catch {
    // Fails loudly, never as an empty vault: an empty result would look like a missing secret.
    throw new Error("Vault could not be decrypted: wrong VAULT_KEY or damaged file");
  }
}

// Keyed by resolved path, because every put rewrites the whole file and two vaults on one path would overwrite each other.
// shortcut: serialized in this process only, upgrade to a file lock if two processes ever write the vault at once.
const writeQueues = new Map<string, Promise<unknown>>();

async function load(target: string, key: Buffer): Promise<Map<string, string>> {
  let file: string;
  try {
    file = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  return decrypt(file, key);
}

export function createVault(env: Record<string, string | undefined> = process.env): Vault {
  const path = () => resolve(ROOT, env.VAULT_PATH || ".vault/vault.json");

  return {
    put(name, value) {
      const target = path();
      const write = (writeQueues.get(target) ?? Promise.resolve()).then(async () => {
        const key = keyFrom(env);
        const secrets = await load(target, key);
        secrets.set(name, value);
        const temp = `${target}.${process.pid}.tmp`;
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(temp, encrypt(secrets, key), { mode: 0o600 });
        await rename(temp, target);
      });
      // One failed put must not fail every put after it.
      writeQueues.set(
        target,
        write.catch(() => {}),
      );
      return write;
    },
    async get(name) {
      const value = (await load(path(), keyFrom(env))).get(name);
      if (value === undefined) throw new Error(`Vault has no secret named "${name}"`);
      return value;
    },
  };
}

export default createVault();
