import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// next runs from apps/dashboard without the root .env, and the scripts read it, so both must see the same database.
// A DATABASE_URL already set wins.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const config: NextConfig = {
  // The demo can run on next dev, and the badge would sit on a panel in front of the room.
  devIndicators: false,
  // A second local server (the sandbox next to the normal preview) needs its own build folder, e.g. NEXT_DIST_DIR=.next/sandbox.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Workspace packages export raw TypeScript.
  transpilePackages: ["@bill-fighter/core", "@bill-fighter/db", "@bill-fighter/shared"],
  serverExternalPackages: ["pg"],
  // The judge sandbox reads the recording at runtime (lib/sandbox.ts). The hosted bundle carries it at ./data (scripts/sandbox-bundle.ts).
  outputFileTracingIncludes: { "/**": ["./data/replay/run.jsonl", "./data/replay/run-email.jsonl"] },
};

export default config;
