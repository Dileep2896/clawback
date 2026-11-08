import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import * as schema from "./schema.ts";

// The docker-compose database, so a fresh worktree with no .env still works. Local only.
export const databaseUrl = () => process.env.DATABASE_URL ?? "postgres://bill:bill@localhost:5433/billfighter";

/**
 * A hosted database (the judge sandbox's managed Postgres) signs with its own root CA. PG_CA holds that PEM, and the
 * certificate is verified against it. pg would read the URL's sslmode as "use the system CAs" and override this, so it goes.
 */
export function poolConfig(url: string, env: NodeJS.ProcessEnv = process.env) {
  // Each serverless instance holds its own pool, so a hosted deployment caps it and lets idle connections go within seconds:
  // instances that sit idle otherwise keep the managed database's connection slots and the next judge cannot connect.
  const limits = env.PG_POOL_MAX ? { max: Number(env.PG_POOL_MAX), idleTimeoutMillis: 2000 } : {};
  if (!env.PG_CA) return { connectionString: url, ...limits };
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  return { connectionString: parsed.toString(), ssl: { ca: env.PG_CA, rejectUnauthorized: true }, ...limits };
}

export function createDb(url: string = databaseUrl()) {
  const pool = new Pool(poolConfig(url));
  // An idle connection the server drops (a frozen serverless instance) errors on the pool; unheard, that kills the process.
  // pg already discards the broken client, so the next query just opens a fresh one.
  pool.on("error", (error) => console.warn(`Postgres dropped an idle connection: ${error.message}`));
  return drizzle(pool, { schema });
}

/** The host pg will really connect to for this URL. Building a Client opens no connection. */
export const databaseHost = (url: string) => new Client({ connectionString: url }).host;

export type Db = ReturnType<typeof createDb>;

// The Pool connects on first query, so importing this is safe with Postgres down.
export const db = createDb();
