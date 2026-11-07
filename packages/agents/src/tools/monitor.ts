import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { runs } from "@bill-fighter/db/schema";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { Scheduler } from "@bill-fighter/platform/types";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineTool } from "../tool-wrapper.ts";

/**
 * The 1st of the next month at 16:00 UTC, about 9am Pacific. A fixed date is what keeps it to one check a month, however many runs finish.
 * shortcut: the month is UTC, so a run in the last hours of a Pacific month counts as the next one. Use the customer's zone if a monthly check ever gets skipped.
 */
export const nextCheckAt = (from: Date) => new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 16));

export function monitorTools({ db = sharedDb, scheduler = () => getPlatform().scheduler() }: { db?: Db; scheduler?: () => Promise<Pick<Scheduler, "schedule">> } = {}) {
  return [
    defineTool({
      name: "schedule_check",
      description: "Schedules next month's bill check for this run's customer. Takes no input. Safe to repeat: it returns the check already scheduled. Returns the check id and when it runs.",
      // Strict: the customer comes from the run, so a model cannot schedule a check for anyone else.
      inputSchema: z.strictObject({}),
      targets: () => [],
      async handler(_input, { runId }) {
        const [run] = await db.select({ customerId: runs.customerId, startedAt: runs.startedAt }).from(runs).where(eq(runs.id, runId));
        if (!run) throw new Error(`Run ${runId} does not exist`);
        const check = await (await scheduler()).schedule({ customerId: run.customerId, runAt: nextCheckAt(run.startedAt) });
        return { checkId: check.id, runAt: check.runAt.toISOString(), status: check.status };
      },
    }),
  ];
}

export default monitorTools();
