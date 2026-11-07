import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { runs } from "@bill-fighter/db/schema";
import { eq, sql } from "drizzle-orm";
import type { Budget, BudgetStatus } from "../types.ts";
import { usdFromEnv } from "./env-usd.ts";

const toStatus = (runId: string, row: { costUsd: number } | undefined): BudgetStatus => {
  // Throws rather than reporting 0: a run with no row would otherwise have no budget at all.
  if (!row) throw new Error(`Run ${runId} does not exist`);
  const capUsd = usdFromEnv("RUN_BUDGET_USD", 5);
  return { totalUsd: row.costUsd, capUsd, over: row.costUsd >= capUsd };
};

/** Costs here are SDK estimates, not bills: on the Claude Code login they are not what the owner is charged. */
export function createBudget(db: Db): Budget {
  return {
    async add(runId, costUsd) {
      if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error(`Invalid cost ${costUsd} for run ${runId}`);
      const [row] = await db
        .update(runs)
        .set({ costUsd: sql`${runs.costUsd} + ${costUsd}::numeric` })
        .where(eq(runs.id, runId))
        .returning({ costUsd: runs.costUsd });
      return toStatus(runId, row);
    },

    async status(runId) {
      const [row] = await db.select({ costUsd: runs.costUsd }).from(runs).where(eq(runs.id, runId));
      return toStatus(runId, row);
    },
  };
}

export default createBudget(sharedDb);
