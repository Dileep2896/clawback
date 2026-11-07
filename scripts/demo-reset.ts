// Clears everything a run leaves behind and keeps the seed, so the next run behaves like the first. Contacts only Postgres and Mailpit.
// Run: pnpm demo:reset. Refuses a non-local DATABASE_URL unless DEMO_RESET_ALLOW_NONLOCAL=1.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RUNS_DIR } from "@bill-fighter/agents/customer-data";
import { databaseHost, databaseUrl, db, type Db } from "@bill-fighter/db/client";

export const RUN_TABLES = ["runs", "findings", "actions", "approvals", "calls", "ledger", "board_cards", "audit_log", "sms_messages", "scheduled_checks"];
const SEED_TABLES = ["customers", "locations", "accounts", "authorizations", "bills", "bill_lines", "usage_intervals", "phone_lines"];
const SEED_COUNTS = `select ${SEED_TABLES.map((table) => `(select count(*)::int from ${table}) as ${table}`).join(", ")}, (select count(*)::int from bills where parsed_json is not null) as parsed_bills`;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

export type ResetOptions = {
  pool: Db["$client"];
  url: string;
  /** Null leaves mail alone: replay must work with only Postgres up. */
  mailpitApi: string | null;
  runsDir: string;
  allowNonlocal: boolean;
};

/** Before any connection, so a refused target is never touched. */
export function checkTarget({ url, mailpitApi, allowNonlocal }: Pick<ResetOptions, "url" | "mailpitApi" | "allowNonlocal">) {
  const parsed = new URL(url);
  // Ask pg, because ?host=, its repeats and its encodings can all send it somewhere other than the URL's hostname.
  const host = databaseHost(url);
  if (!LOCAL_HOSTS.includes(host) && !allowNonlocal) {
    throw new Error(`Refusing to reset a database on "${host}", which is not local. Set DEMO_RESET_ALLOW_NONLOCAL=1 only if that really is the demo's database.`);
  }
  if (!decodeURIComponent(parsed.pathname.slice(1))) throw new Error("Refusing to reset: DATABASE_URL names no database.");
  if (mailpitApi && !LOCAL_HOSTS.includes(new URL(mailpitApi).hostname)) throw new Error(`Refusing to clear mail at ${mailpitApi}, which is not local Mailpit.`);
}

/** Asks the server, because PGDATABASE or an encoded path can connect pg to a database the URL does not name. */
export async function checkConnected({ pool, url }: Pick<ResetOptions, "pool" | "url">) {
  const named = decodeURIComponent(new URL(url).pathname.slice(1));
  let connected: string;
  try {
    connected = (await pool.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
  } catch (cause) {
    throw new Error("Cannot reach Postgres. Run `docker compose up -d --wait` first.", { cause });
  }
  if (connected !== named) throw new Error(`Refusing to reset: DATABASE_URL names "${named}" but the server connected to "${connected}".`);
}

async function clearMailpit(api: string) {
  const target = new URL("/api/v1/messages", api);
  let response: Response;
  try {
    response = await fetch(target, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  } catch (cause) {
    throw new Error(`Cannot reach Mailpit at ${api}. Run \`docker compose up -d --wait\` first.`, { cause });
  }
  if (!response.ok) throw new Error(`Mailpit refused to clear its messages: ${response.status}`);
}

async function clearTables(pool: Db["$client"], before: Record<string, number>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A dashboard or a stuck session can hold a lock, and a clear error beats a hang.
    await client.query("SET LOCAL lock_timeout = '5s'");
    // No CASCADE: a future table that references these must fail here, not be emptied.
    await client.query(`TRUNCATE ${RUN_TABLES.join(", ")}`);
    const after = (await client.query<Record<string, number>>(SEED_COUNTS)).rows[0]!;
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error(`The seed changed during the reset, so nothing was cleared from the database. Before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The database goes last, because its run ids are how a failed reset finds the folders when it runs again. */
export async function demoReset(options: ResetOptions) {
  const { pool, mailpitApi, runsDir } = options;
  checkTarget(options);
  await checkConnected(options);

  const seed = (await pool.query<Record<string, number>>(SEED_COUNTS)).rows[0]!;
  const runRows = (await pool.query<{ id: string; status: string }>("select id, status from runs")).rows;
  // Ids become folder names under a directory other lanes share.
  const unsafe = runRows.filter(({ id }) => !/^\w[\w.-]*$/.test(id)).map(({ id }) => JSON.stringify(id));
  if (unsafe.length > 0) throw new Error(`Refusing to reset: run ids that cannot name a folder: ${unsafe.join(", ")}`);

  const running = runRows.filter(({ status }) => status === "running").map(({ id }) => id);
  if (running.length > 0) {
    console.warn(`Clearing runs still marked running: ${running.join(", ")}. If one is alive, its agents will wrap up and can write into the next run, so restart \`pnpm dev:webhooks\`.`);
  }

  if (mailpitApi) await clearMailpit(mailpitApi);
  // shortcut: a folder with no row stays on disk, which is harmless because every run gets a new id. Wiping the parent would delete other lanes' live runs.
  await Promise.all(runRows.map(({ id }) => rm(join(runsDir, id), { recursive: true, force: true })));
  await clearTables(pool, seed);
  return { runs: runRows.length, running, seed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { runs, seed } = await demoReset({
      pool: db.$client,
      url: databaseUrl(),
      mailpitApi: process.env.MAILPIT_API || "http://localhost:8025",
      runsDir: RUNS_DIR,
      allowNonlocal: process.env.DEMO_RESET_ALLOW_NONLOCAL === "1",
    });
    console.info(`Cleared ${RUN_TABLES.join(", ")}, the Mailpit inbox, and the folders of ${runs} runs.`);
    console.info(`Kept the seed: ${Object.entries(seed).map(([name, count]) => `${count} ${name}`).join(", ")}.`);
  } catch (error) {
    console.error(`Reset stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}
