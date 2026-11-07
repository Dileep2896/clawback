// Inserts a made-up run, frozen mid-flight, so the dashboard has data before the agents run. Never on the shared database.
// pnpm exec tsx --env-file-if-exists=.env scripts/sample-run.ts
import { db } from "@bill-fighter/db/client";
import { assertNotSharedDb, insertSampleRun, SAMPLE_RUN_ID } from "../apps/dashboard/lib/sample-data.ts";

try {
  assertNotSharedDb();
  await insertSampleRun(db);
  console.info(`Inserted ${SAMPLE_RUN_ID}. Open http://localhost:3000/agents after pnpm dev:dashboard.`);
} catch (error) {
  console.error(error);
  console.error("If the tables are missing, run `pnpm db:migrate` first.");
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
