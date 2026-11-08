// Redeploys the judge sandbox (naïve App clawback-sandbox) from the current commit: records the balance, brings its
// database up to date, ships a fresh bundle, waits for the build, records the balance again and fails on any charge.
// Usage: pnpm sandbox:redeploy. Needs NAIVE_API_KEY in .env; prints no secrets. Creates nothing else on naïve.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NaiveError, naiveClient } from "@bill-fighter/platform/naive/client";
import { bundle } from "./sandbox-bundle.ts";

const APP = "app_1hzp4arjghgndxtd91tm2qg5p4";
type Call = ReturnType<typeof naiveClient>;
type Deployment = { id: string; status: "queued" | "building" | "ready" | "error"; url: string | null; error: string | null };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// shortcut: every migration after the first deploy, written to run twice safely; switch to the db/migrations ledger when the next one lands.
export const CATCH_UP_SQL = ["ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip_hash text"];

/** The API answers 429 "at capacity" often; a retry half a minute later goes through. Anything else fails at once. */
export async function retrying<T>(fn: () => Promise<T>, wait = sleep, tries = 12): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof NaiveError && error.status === 429) || i >= tries) throw error;
      console.info(`rate limited, retry ${i} in 30 s`);
      await wait(30_000);
    }
  }
}

/** Polls until the deployment's build is ready, or throws with the build's error. */
export async function waitReady(call: Call, id: string, wait = sleep, polls = 80) {
  for (let i = 0; i < polls; i++) {
    await wait(15_000);
    const { data } = await retrying(() => call<{ data: Deployment[] }>("GET", `/apps/${APP}/deployments?limit=5`), wait);
    const deployment = data.find((d) => d.id === id);
    console.info(`${new Date().toISOString()} ${id}: ${deployment?.status ?? "not listed yet"}`);
    if (deployment?.status === "ready") return deployment;
    if (deployment?.status === "error") throw new Error(`Build failed: ${deployment.error}`);
  }
  throw new Error(`${id} not ready after ${polls} polls`);
}

async function main() {
  const call = naiveClient();
  const balance = async () => (await retrying(() => call<{ balance_micro_usd: number }>("GET", "/credits/balance"))).balance_micro_usd;
  const before = await balance();
  console.info(`${new Date().toISOString()} balance before: $${before / 1e6}`);

  // Documented body: { query: string } (docs/api/database, "Run SQL").
  for (const query of CATCH_UP_SQL) await retrying(() => call("POST", `/apps/${APP}/db/query`, { query }));
  const { rows } = await retrying(() =>
    call<{ rows: unknown[] }>("POST", `/apps/${APP}/db/query`, { query: "select 1 from information_schema.columns where table_name = 'users' and column_name = 'signup_ip_hash'" }),
  );
  if (rows.length !== 1) throw new Error("users.signup_ip_hash is still missing");
  console.info("database up to date");

  const out = mkdtempSync(join(tmpdir(), "sandbox-bundle-"));
  console.info("bundle:", bundle(out));
  const body = JSON.parse(readFileSync(join(out, "deploy.json"), "utf8")) as unknown;
  const { id } = await retrying(() => call<Deployment>("POST", `/apps/${APP}/deployments`, body));
  console.info(`ready: ${(await waitReady(call, id)).url}`);

  const after = await balance();
  console.info(`${new Date().toISOString()} balance after: $${after / 1e6}`);
  if (after !== before) throw new Error(`The balance moved by $${(before - after) / 1e6}: stop and ask before anything else`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
