// Clears everything a run leaves behind and keeps the seed, so the next run behaves like the first. Contacts only Postgres and Mailpit.
// Run: pnpm demo:reset. Refuses a non-local DATABASE_URL unless DEMO_RESET_ALLOW_NONLOCAL=1.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RUNS_DIR } from "@bill-fighter/agents/customer-data";
import { UPLOADS_DIR } from "@bill-fighter/webhooks/dashboard";
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
  /** Where the dashboard keeps uploaded PDFs, one folder per customer. Absent leaves them alone. */
  uploadsDir?: string;
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

/**
 * Demo sign-ups go, so sign-up can be repeated on stage: every user, and the customers sign-up created with the locations,
 * accounts and bills their uploads added. The seeded customer is never one of them. Returns the deleted customer ids.
 * Runs inside the caller's transaction, so a reset that fails later keeps every sign-up.
 */
export async function clearSignups(client: Pick<Db["$client"], "query">): Promise<string[]> {
  const created = (await client.query<{ id: string }>("select distinct customer_id as id from users where created_customer")).rows.map(({ id }) => id);
  await client.query("TRUNCATE users");
  if (created.length > 0) {
    const accountsOf = "select a.id from accounts a join locations l on l.id = a.location_id where l.customer_id = any($1)";
    await client.query(`delete from bill_lines where bill_id in (select id from bills where account_id in (${accountsOf}))`, [created]);
    await client.query(`delete from bills where account_id in (${accountsOf})`, [created]);
    await client.query(`delete from accounts where id in (${accountsOf})`, [created]);
    await client.query("delete from locations where customer_id = any($1)", [created]);
    // No other table may still point at these customers: a run or finding for one fails here rather than vanishing.
    await client.query("delete from customers where id = any($1)", [created]);
  }
  return created;
}

/** Sign-ups and run tables in one transaction: any failure, including a seed that changed meanwhile, rolls back both. */
async function clearDatabase(pool: Db["$client"]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A dashboard or a stuck session can hold a lock, and a clear error beats a hang.
    await client.query("SET LOCAL lock_timeout = '5s'");
    const signups = await clearSignups(client);
    // Counted after the sign-ups go, so the check below proves the seed itself was untouched.
    const seed = (await client.query<Record<string, number>>(SEED_COUNTS)).rows[0]!;
    // No CASCADE: a future table that references these must fail here, not be emptied.
    await client.query(`TRUNCATE ${RUN_TABLES.join(", ")}`);
    const after = (await client.query<Record<string, number>>(SEED_COUNTS)).rows[0]!;
    if (JSON.stringify(after) !== JSON.stringify(seed)) {
      throw new Error(`The seed changed during the reset, so nothing was cleared from the database. Before ${JSON.stringify(seed)}, after ${JSON.stringify(after)}`);
    }
    await client.query("COMMIT");
    return { signups, seed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Every check comes first, and the database goes last, because its run ids are how a failed reset finds the folders when it runs again. */
export async function demoReset(options: ResetOptions) {
  const { pool, mailpitApi, runsDir } = options;
  checkTarget(options);
  await checkConnected(options);

  const runRows = (await pool.query<{ id: string; status: string; replayed: boolean }>("select id, status, replay is not null as replayed from runs")).rows;
  // Ids become folder names under a directory other lanes share.
  const unsafe = runRows.filter(({ id }) => !/^\w[\w.-]*$/.test(id)).map(({ id }) => JSON.stringify(id));
  if (unsafe.length > 0) throw new Error(`Refusing to reset: run ids that cannot name a folder: ${unsafe.join(", ")}`);

  const running = runRows.filter(({ status }) => status === "running").map(({ id }) => id);
  if (running.length > 0) {
    console.warn(`Clearing runs still marked running: ${running.join(", ")}. If one is alive, its agents will wrap up and can write into the next run, so restart \`pnpm dev:webhooks\`.`);
  }

  if (mailpitApi) await clearMailpit(mailpitApi);
  // shortcut: a folder with no row stays on disk, which is harmless because every run gets a new id. Wiping the parent would delete other lanes' live runs.
  // A replayed run keeps its recorded id, so its folder belongs to the database that captured it, maybe another lane's.
  await Promise.all(runRows.filter(({ replayed }) => !replayed).map(({ id }) => rm(join(runsDir, id), { recursive: true, force: true })));
  const { signups, seed } = await clearDatabase(pool);
  // Only after the commit, so a failed reset keeps the uploaded PDFs. Customer ids are generated uuids, checked anyway before they name a folder.
  if (options.uploadsDir) {
    await Promise.all(signups.filter((id) => /^\w[\w.-]*$/.test(id)).map((id) => rm(join(options.uploadsDir!, id), { recursive: true, force: true })));
  }
  return { runs: runRows.length, running, seed, signups: signups.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { runs, seed, signups } = await demoReset({
      pool: db.$client,
      url: databaseUrl(),
      mailpitApi: process.env.MAILPIT_API || "http://localhost:8025",
      runsDir: RUNS_DIR,
      uploadsDir: UPLOADS_DIR,
      allowNonlocal: process.env.DEMO_RESET_ALLOW_NONLOCAL === "1",
    });
    console.info(`Cleared ${RUN_TABLES.join(", ")}, the Mailpit inbox, and the folders of ${runs} runs.`);
    console.info(`Cleared every demo sign-up, and the ${signups} customers they created with their uploaded bills.`);
    console.info(`Kept the seed: ${Object.entries(seed).map(([name, count]) => `${count} ${name}`).join(", ")}.`);
  } catch (error) {
    console.error(`Reset stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}
