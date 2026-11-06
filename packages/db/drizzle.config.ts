import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";
import { databaseUrl } from "./src/client.ts";

// pnpm --filter runs this from packages/db without the root .env. A DATABASE_URL already set wins.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: databaseUrl() },
});
