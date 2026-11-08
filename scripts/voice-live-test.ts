// pnpm exec tsx --env-file=.env scripts/voice-live-test.ts --place-real-call
// PLACES ONE REAL, PAID CALL through the real call_provider, on a throwaway database. Run it only with the word for that exact call.
// A failed call stops here rather than running the sim, so the failure is plain and the test spends nothing more.
import { calls } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { allowlistFromEnv } from "@bill-fighter/shared/allowlist";
import { negotiatorTools } from "@bill-fighter/agents/tools/negotiator";
import { wrapTool } from "@bill-fighter/agents/tool-wrapper";
import { liveRowProblems, runLiveCall } from "@bill-fighter/voice/live/caller/engine";
import { SEED_PLAN, seedCallData, seedCallFacts } from "@bill-fighter/voice/sim/fixture";
import type { TranscriptRow } from "@bill-fighter/voice/transcript";

if (!process.argv.includes("--place-real-call")) throw new Error("This places a real, paid call. Pass --place-real-call only with the word for that exact call.");
if (process.env.VOICE_MODE !== "live") throw new Error("Set VOICE_MODE=live");

const ACTION = "voice-live-test";

await withTestDb("voice_live_test", async (db) => {
  await seedCallData(db, ACTION, SEED_PLAN);
  await seedCallFacts(db, ACTION);

  const tools = negotiatorTools({
    db,
    budget: async () => ({
      add: async (_, usd) => ({ totalUsd: usd, capUsd: 5, over: false }),
      status: async () => ({ totalUsd: 0, capUsd: 5, over: false }),
    }),
    live: (call) => runLiveCall({ db, ...call }),
    sim: async ({ fallbackReason }) => {
      throw new Error(`The live call failed, and this test runs no sim: ${fallbackReason}`);
    },
    email: async () => {
      throw new Error("This test places a call, never an email");
    },
  });
  const tool = wrapTool(tools.find((candidate) => candidate.name === "call_provider")!, {
    audit: { record: async () => {}, list: async () => [] },
    allowlist: allowlistFromEnv(),
  });

  let failure: unknown;
  try {
    console.log(await tool.handler({ actionId: ACTION }, { runId: "voice-live-test", agent: "negotiator" }));
  } catch (error) {
    failure = error;
  }

  // Printed before the throwaway database goes, because this is the only record of the saved row.
  const saved = await db.select().from(calls);
  for (const call of saved) {
    const { transcriptJson, ...rest } = call;
    console.log(rest);
    for (const row of (transcriptJson ?? []) as TranscriptRow[]) console.log(`${row.at.slice(11, 19)} ${row.role}${row.kind === "speech" ? "" : ` [${row.kind}]`}: ${row.content}`);
  }
  if (failure) {
    console.error("CALL FAILED:", failure);
    process.exitCode = 1;
  }
  const problems = liveRowProblems(saved.find((call) => call.mode === "live"), SEED_PLAN);
  if (problems.length) {
    console.error(`TEST FAILED:\n${problems.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("TEST PASSED: all seven lines, three promo accounts, the ticket and a recording URL are saved.");
  }
});
