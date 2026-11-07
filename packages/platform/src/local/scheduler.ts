import { type Db, db as defaultDb } from "@bill-fighter/db/client";
import { scheduledChecks } from "@bill-fighter/db/schema";
import { and, eq, lte } from "drizzle-orm";
import cron, { type ScheduledTask } from "node-cron";
import type { ScheduledCheck, Scheduler } from "../types.ts";

export function createScheduler(db: Db): Scheduler & { fireDue(): Promise<void>; stop(): void } {
  let handler: ((check: ScheduledCheck) => Promise<void>) | undefined;
  let task: ScheduledTask | undefined;
  let recovered: Promise<unknown> | undefined;

  // A row still 'running' here was interrupted by an exit, so it goes back in the queue. Only until it first succeeds,
  // so a later onFire cannot requeue a handler that is really running. A failure is forgotten so the next call retries;
  // nothing has been claimed by then, because claims wait on this.
  // shortcut: assumes one scheduler process, as local has. Upgrade to a lease if a second one ever runs.
  const recover = () =>
    (recovered ??= db
      .update(scheduledChecks)
      .set({ status: "pending" })
      .where(eq(scheduledChecks.status, "running"))
      .catch((error) => {
        recovered = undefined;
        throw error;
      }));

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
      recover().catch((error) => console.error("[scheduler] could not requeue interrupted checks:", error));
      // Due rows are read from Postgres each minute, so a restart loses nothing.
      task ??= cron.schedule("* * * * *", () => scheduler.fireDue(), { noOverlap: true });
    },

    async fire(checkId: string) {
      if (!handler) throw new Error("Scheduler has no onFire handler");
      // Otherwise the requeue could reset a row this call has just claimed, and it would run twice.
      await recover();
      // An atomic claim, so a cron tick and a manual fire cannot both run one check.
      const [claimed] = await db
        .update(scheduledChecks)
        .set({ status: "running" })
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
      await db.update(scheduledChecks).set({ status: "fired" }).where(eq(scheduledChecks.id, checkId));
    },

    /** One cron tick. A failure is logged here because nothing else awaits a tick, and one bad check must not stop the rest. */
    async fireDue() {
      try {
        await recover();
        const due = await db
          .select()
          .from(scheduledChecks)
          .where(and(eq(scheduledChecks.status, "pending"), lte(scheduledChecks.runAt, new Date())));
        for (const check of due) {
          await scheduler.fire(check.id).catch((error) => console.error(`[scheduler] check ${check.id} failed:`, error));
        }
      } catch (error) {
        console.error("[scheduler] could not requeue interrupted checks or read due ones:", error);
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
