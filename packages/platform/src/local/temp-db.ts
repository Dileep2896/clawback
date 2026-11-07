import { fileURLToPath } from "node:url";
import { createDb, databaseUrl } from "@bill-fighter/db/client";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export type Db = ReturnType<typeof createDb>;

const migrationsFolder = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

const urlFor = (database: string) => {
  const url = new URL(databaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
};

async function admin(statement: string) {
  const db = createDb(urlFor("postgres"));
  try {
    await db.$client.query(statement);
  } catch (cause) {
    throw new Error(`Postgres refused "${statement}". Is it up? Run \`docker compose up -d --wait\`.`, { cause });
  } finally {
    await db.$client.end();
  }
}

/** Runs fn against a fresh, migrated database, never the shared one. Per process, because all worktrees share Postgres. */
export async function withTempDb<T>(name: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const database = `billfighter_check_${name}_${process.pid}`;
  await admin(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${database}`);
  const db = createDb(urlFor(database));
  try {
    await migrate(db, { migrationsFolder });
    return await fn(db);
  } finally {
    await db.$client.end();
    await admin(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  }
}
