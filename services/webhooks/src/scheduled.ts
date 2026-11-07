import { setTimeout as sleep } from "node:timers/promises";
import { executeRun, scheduledRunPrompt } from "@bill-fighter/agents/run";
import { runEventLog } from "@bill-fighter/agents/run-log";
import { accounts, locations, runs, scheduledChecks } from "@bill-fighter/db/schema";
import { platformName } from "@bill-fighter/platform/factory";
import type { ScheduledCheck, Scheduler } from "@bill-fighter/platform/types";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { InboundDeps, InboundReply } from "./inbound.ts";

type RunDeps = Pick<InboundDeps, "db" | "runtime" | "audit" | "tools">;

const dedupeKey = (checkId: string) => `scheduled-check:${checkId}`;
const STARTUP_WAIT_MS = 5_000;
const STARTUP_POLL_MS = 50;

/**
 * The Scheduler's onFire handler. The run is not awaited: it can wait hours on the owner's approval, and a cron tick fires its due checks one at a time.
 * So "fired" means the run started, and how the run went is on its own row.
 */
export async function startScheduledRun(check: ScheduledCheck, { db, runtime, audit, tools }: RunDeps) {
  const [account] = await db
    .select({ accountNumber: accounts.accountNumber })
    .from(accounts)
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(eq(locations.customerId, check.customerId))
    .orderBy(asc(accounts.accountNumber))
    .limit(1);
  if (!account) throw new Error(`Customer ${check.customerId} has no accounts to check`);

  // The scheduler requeues a check interrupted by an exit, and this key stops that starting a second run.
  const [created] = await db
    .insert(runs)
    .values({ customerId: check.customerId, platform: platformName(), trigger: "schedule", dedupeKey: dedupeKey(check.id), status: "running" })
    .onConflictDoNothing({ target: runs.dedupeKey })
    .returning({ id: runs.id });
  if (!created) return;

  // shortcut: the run lives in this process, as an inbound one does, so a crash leaves its row "running". Upgrade when a run can be resumed.
  void executeRun({ db, runId: created.id, prompt: scheduledRunPrompt(account.accountNumber), runtime, audit, tools, onEvent: runEventLog(created.id) }).catch((error: unknown) => {
    console.error(`Run ${created.id}: could not record its result:`, error);
  });
}

/** Forces a check now. Answers with its run, so firing it again finds the same run rather than a second one. */
export async function handleFireCheck(payload: unknown, { db, scheduler }: Pick<InboundDeps, "db"> & { scheduler: Pick<Scheduler, "fire"> }): Promise<InboundReply> {
  const input = z.strictObject({ checkId: z.string().min(1) }).safeParse(payload);
  if (!input.success) return { status: 400, body: { error: "Expected { checkId }" } };
  const { checkId } = input.data;

  const [check] = await db.select({ id: scheduledChecks.id }).from(scheduledChecks).where(eq(scheduledChecks.id, checkId));
  if (!check) return { status: 404, body: { error: `No scheduled check ${checkId}` } };

  await scheduler.fire(checkId);
  // fire() returns at once for a check it did not claim, and whoever did claim it may not have inserted the run yet.
  for (const deadline = Date.now() + STARTUP_WAIT_MS; Date.now() < deadline; await sleep(STARTUP_POLL_MS)) {
    // Status before run: a check already seen as finished cannot gain a run after this read.
    const [current] = await db.select({ status: scheduledChecks.status }).from(scheduledChecks).where(eq(scheduledChecks.id, checkId));
    const [run] = await db.select({ id: runs.id }).from(runs).where(eq(runs.dedupeKey, dedupeKey(checkId)));
    if (run) return { status: 200, body: { runId: run.id } };
    if (current?.status !== "running") return { status: 409, body: { error: `Scheduled check ${checkId} has no run and cannot start one` } };
  }
  return { status: 503, body: { error: `Scheduled check ${checkId} is still starting, try again` } };
}
