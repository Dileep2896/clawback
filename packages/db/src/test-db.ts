import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createDb, databaseUrl, type Db } from "./client.ts";
import { customers, runs } from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

const urlFor = (database: string) => {
  const url = new URL(databaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
};

async function admin(statement: string) {
  const client = new Client({ connectionString: urlFor("postgres") });
  try {
    await client.connect();
  } catch (cause) {
    throw new Error("Cannot reach Postgres. Run `docker compose up -d --wait` first.", { cause });
  }
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** Runs fn on a freshly migrated database of its own, so tests and checks never write to the shared billfighter one. */
export async function withTestDb<T>(name: string, fn: (db: Db) => Promise<T>): Promise<T> {
  // Per process, because every worktree shares one Postgres and may run this at the same time.
  const database = `billfighter_test_${name}_${process.pid}`;
  if (!/^\w+$/.test(database)) throw new Error(`Invalid test database name "${database}"`);
  await admin(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${database}`);
  const db = createDb(urlFor(database));
  try {
    await migrate(db, { migrationsFolder });
    // Open connections up front: otherwise the first caller in a race finishes while the others are still connecting.
    await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`SELECT pg_sleep(0.02)`)));
    return await fn(db);
  } finally {
    await db.$client.end();
    await admin(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  }
}

/** The customer and run rows that board cards, approvals and budgets hang off. */
export async function seedRun(db: Db, runId: string) {
  const customerId = `customer-${runId}`;
  await db.insert(customers).values({
    id: customerId,
    name: "Test Noodle Co",
    contactName: "Test Owner",
    contactEmail: "owner@billfighter.local",
    contactPhone: "+15550001111",
  });
  await db.insert(runs).values({ id: runId, customerId, platform: "local", trigger: "manual", status: "running" });
  return { customerId };
}
