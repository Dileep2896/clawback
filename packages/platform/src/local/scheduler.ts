import { db as defaultDb } from "@bill-fighter/db/client";
import { scheduledChecks } from "@bill-fighter/db/schema";
import { and, eq, lte } from "drizzle-orm";
import cron, { type ScheduledTask } from "node-cron";
import type { ScheduledCheck, Scheduler } from "../types.ts";
import type { Db } from "./temp-db.ts";

export function createScheduler(db: Db): Scheduler & { fireDue(): Promise<void>; stop(): void } {
  let handler: ((check: ScheduledCheck) => Promise<void>) | undefined;
  let task: ScheduledTask | undefined;

  const scheduler = {
    async schedule({ customerId, runAt }: { customerId: string; runAt: Date }) {
      const [created] = await db
        .insert(scheduledChecks)
        .values({ customerId, runAt, status: "pending" })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      const [existing] = await db
        .select()
        .from(scheduledChecks)
        .where(and(eq(scheduledChecks.customerId, customerId), eq(scheduledChecks.runAt, runAt)));
      // The insert only skips on a conflict with this row.
      return existing!;
    },

    onFire(next: (check: ScheduledCheck) => Promise<void>) {
      handler = next;
      // Due rows are read from Postgres each minute, so a restart loses nothing.
      task ??= cron.schedule("* * * * *", () => scheduler.fireDue(), { noOverlap: true });
    },

    async fire(checkId: string) {
      if (!handler) throw new Error("Scheduler has no onFire handler");
      // An atomic claim, so a cron tick and a manual fire cannot both run one check.
      const [claimed] = await db
        .update(scheduledChecks)
        .set({ status: "fired" })
        .where(and(eq(scheduledChecks.id, checkId), eq(scheduledChecks.status, "pending")))
        .returning();
      if (!claimed) {
        const [existing] = await db.select().from(scheduledChecks).where(eq(scheduledChecks.id, checkId));
        if (!existing) throw new Error(`No scheduled check ${checkId}`);
        return;
      }
      try {
        await handler(claimed);
      } catch (error) {
        // No automatic retry: a broken check must not rerun every minute.
        await db.update(scheduledChecks).set({ status: "failed" }).where(eq(scheduledChecks.id, checkId));
        throw error;
      }
    },

    /** One cron tick. A failure is logged here because nothing else awaits a tick, and one bad check must not stop the rest. */
    async fireDue() {
      try {
        const due = await db
          .select()
          .from(scheduledChecks)
          .where(and(eq(scheduledChecks.status, "pending"), lte(scheduledChecks.runAt, new Date())));
        for (const check of due) {
          await scheduler.fire(check.id).catch((error) => console.error(`[scheduler] check ${check.id} failed:`, error));
        }
      } catch (error) {
        console.error("[scheduler] could not read due checks:", error);
      }
    },

    stop() {
      void task?.destroy();
      task = undefined;
    },
  };
  return scheduler;
}

export default createScheduler(defaultDb);
