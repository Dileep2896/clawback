// pnpm exec tsx services/voice/src/sim/cli.ts
// One real sim call on the Claude Code login, on a throwaway database. Spends login usage, about 30 model calls.
import { calls } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { TranscriptRow } from "../transcript.ts";
import { runSimCall } from "./engine.ts";
import { SEED_PLAN, seedCallData } from "./fixture.ts";

const llm = await getPlatform().llm();

await withTestDb("voice_sim_run", async (db) => {
  await seedCallData(db, "action");
  let costUsd = 0;
  let modelCalls = 0;
  const started = Date.now();
  let failure: unknown;
  try {
    await runSimCall({
      db,
      llm,
      actionId: "action",
      plan: SEED_PLAN,
      onCost: (usd) => {
        costUsd += usd;
        modelCalls += 1;
      },
    });
  } catch (error) {
    failure = error;
  }
  const seconds = (Date.now() - started) / 1000;

  const [call] = await db.select().from(calls);
  const rows = (call?.transcriptJson ?? []) as TranscriptRow[];
  for (const row of rows) console.log(`${row.at.slice(11, 19)} ${row.role}${row.kind === "speech" ? "" : ` [${row.kind}]`}: ${row.content}`);
  console.log(`\nTime: ${seconds.toFixed(1)} s. Model calls: ${modelCalls}. Estimated cost (SDK): $${costUsd.toFixed(4)}.`);
  if (failure) {
    console.error("CALL FAILED:", failure);
    process.exitCode = 1;
  }
});
