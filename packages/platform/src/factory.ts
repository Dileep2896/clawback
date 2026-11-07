import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Interfaces, Platform } from "./types.ts";

const PLATFORMS = ["local", "naive"] as const;
export type PlatformName = (typeof PLATFORMS)[number];

export const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// Each file sits at src/<platform>/<file>.ts and default-exports an object implementing its interface.
export const ADAPTER_FILES: { [K in keyof Interfaces]: string } = {
  agentRuntime: "agent-runtime",
  approvalGate: "approval-gate",
  audit: "audit",
  board: "board",
  browser: "browser",
  budget: "budget",
  card: "card",
  identity: "identity",
  llm: "llm",
  mail: "mail",
  scheduler: "scheduler",
  sms: "sms",
  vault: "vault",
};

export function platformName(): PlatformName {
  const name = process.env.PLATFORM || "local";
  if (!(PLATFORMS as readonly string[]).includes(name)) {
    throw new Error(`Unknown PLATFORM "${name}": expected one of ${PLATFORMS.join(", ")}`);
  }
  return name as PlatformName;
}

// shortcut: finds adapters on disk, so it will not work inside a Next.js bundle. The dashboard goes straight to
// Postgres; upgrade to an explicit import map if a bundled app ever needs getPlatform().
export function createPlatform(name: PlatformName, srcDir: string = SRC_DIR): Platform {
  const load = async <K extends keyof Interfaces>(key: K): Promise<Interfaces[K]> => {
    const file = ADAPTER_FILES[key];
    const path = join(srcDir, name, `${file}.ts`);
    if (!existsSync(path)) {
      throw new Error(`Platform "${name}": adapter ${file} is not built yet (expected ${name}/${file}.ts)`);
    }
    const adapter = (await import(/* @vite-ignore */ pathToFileURL(path).href)).default;
    if (!adapter) throw new Error(`Platform "${name}": ${name}/${file}.ts has no default export`);
    return adapter;
  };
  const keys = Object.keys(ADAPTER_FILES) as (keyof Interfaces)[];
  return Object.fromEntries(keys.map((key) => [key, () => load(key)])) as Platform;
}

export const getPlatform = (): Platform => createPlatform(platformName());
