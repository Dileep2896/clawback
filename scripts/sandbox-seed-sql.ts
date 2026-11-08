// SQL that sets up the judge sandbox's managed Postgres, which hands out no connection string: only an SQL endpoint (naïve
// POST /v1/apps/{id}/db/query, 30 s per request). Writes numbered files: the migrations, then the demo customer's seed rows.
// Usage: pnpm exec tsx --env-file-if-exists=.env scripts/sandbox-seed-sql.ts <out-dir>. Needs the local Docker Postgres.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSeed } from "@bill-fighter/db/seed/generate";
import { loadSeed } from "@bill-fighter/db/seed/load";
import { withTestDb } from "@bill-fighter/db/test-db";

const MIGRATIONS = fileURLToPath(new URL("../packages/db/migrations", import.meta.url));
// Parents first. Not usage_intervals (432k rows): the dashboard shows data/replay/usage.json for a judge, and the sandbox never runs an audit.
const TABLES = ["customers", "authorizations", "locations", "accounts", "bills", "bill_lines", "phone_lines"];
// Rows per statement, well inside one request's time and size.
const CHUNK = 500;

/** One statement per chunk: the rows travel as one JSON literal, so no value is ever spliced into SQL by hand. */
export function insertSql(table: string, rows: unknown[]) {
  const json = JSON.stringify(rows);
  if (json.includes("$seed$")) throw new Error(`${table} holds the quote tag`);
  return `insert into ${table} select * from jsonb_populate_recordset(null::${table}, $seed$${json}$seed$::jsonb) on conflict (id) do nothing;`;
}

async function main(out: string) {
  mkdirSync(out, { recursive: true });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  let n = 0;
  const write = (name: string, sql: string) => writeFileSync(join(out, `${String(n++).padStart(2, "0")}-${name}.sql`), sql);
  for (const { tag } of journal.entries) write(tag, readFileSync(join(MIGRATIONS, `${tag}.sql`), "utf8").replaceAll("--> statement-breakpoint", ""));

  await withTestDb("sandbox_seed", async (db) => {
    await loadSeed(db, generateSeed());
    for (const table of TABLES) {
      const { rows } = await db.$client.query<{ row: unknown }>(`select to_jsonb(x) as row from ${table} x order by id`);
      for (let i = 0; i < rows.length; i += CHUNK) write(`${table}-${i / CHUNK}`, insertSql(table, rows.slice(i, i + CHUNK).map(({ row }) => row)));
    }
  });
  console.info(`Wrote ${n} files to ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) throw new Error("Usage: scripts/sandbox-seed-sql.ts <out-dir>");
  await main(out);
}
