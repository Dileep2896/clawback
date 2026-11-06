import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

// The docker-compose database, so a fresh worktree with no .env still works. Local only.
export const databaseUrl = () => process.env.DATABASE_URL ?? "postgres://bill:bill@localhost:5433/billfighter";

export const createDb = (url: string = databaseUrl()) => drizzle(new Pool({ connectionString: url }), { schema });

// The Pool connects on first query, so importing this is safe with Postgres down.
export const db = createDb();
