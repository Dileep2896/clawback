import type { AddressInfo } from "node:net";
import type { Db } from "@bill-fighter/db/client";
import { accounts, customers, locations, runs, scheduledChecks } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { createAudit } from "@bill-fighter/platform/local/audit";
import { createMail } from "@bill-fighter/platform/local/mail";
import { createScheduler } from "@bill-fighter/platform/local/scheduler";
import type { RunEvent, RunSpec } from "@bill-fighter/platform/types";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startScheduledRun } from "./scheduled.ts";
import { createInboundServer, FIRE_CHECK_PATH } from "./server.ts";

// Each test migrates a fresh database on the Postgres every worktree shares, which is slow under load.
vi.setConfig({ testTimeout: 60_000 });

const PAST = new Date("2026-01-01T16:00:00Z");

async function addCustomer(db: Db, id: string, accountNumbers: string[]) {
  await db.insert(customers).values({ id, name: id, contactName: "Owner", contactEmail: "o@billfighter.local", contactPhone: "+15550001111" });
  await db.insert(locations).values({ id: `${id}-loc`, customerId: id, name: "Store", address: "1 Main St", city: "Oakland" });
  for (const accountNumber of accountNumbers) {
    await db.insert(accounts).values({ id: accountNumber, locationId: `${id}-loc`, provider: "baycurrent", accountNumber, serviceType: "electric" });
  }
}

/** A fake runtime, so no test here reaches a model. The scheduler is real, and its cron is stopped afterwards. */
function setup(db: Db) {
  const run = vi.fn<(spec: RunSpec) => AsyncGenerator<RunEvent>>(async function* () {
    yield { type: "result", status: "success", costUsd: 0 };
  });
  const deps = { db, runtime: { run }, audit: createAudit(db), tools: [] };
  const scheduler = createScheduler(db);
  scheduler.onFire((check) => startScheduledRun(check, deps));
  return { deps, run, scheduler };
}

const finished = async (db: Db, runId: string) => {
  let row: typeof runs.$inferSelect | undefined;
  await vi.waitFor(async () => {
    [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row?.finishedAt).toBeTruthy();
  }, 30_000);
  return row!;
};

const statusOf = async (db: Db, id: string) => (await db.select().from(scheduledChecks).where(eq(scheduledChecks.id, id)))[0]!.status;

beforeEach(() => {
  // Starting a run warns about roster tools not built in this test.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("forced firing", () => {
  it("POST /fire-check starts one run with trigger=schedule for the check's customer", async () => {
    await withTestDb("monitor_fire", async (db) => {
      await addCustomer(db, "noodle", ["BE-2", "BE-1"]);
      await addCustomer(db, "other", ["BE-9"]);
      const { deps, run, scheduler } = setup(db);
      const check = await scheduler.schedule({ customerId: "noodle", runAt: new Date("2030-01-01T16:00:00Z") });
      const server = createInboundServer({ ...deps, mail: createMail({}), scheduler });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const post = (body: string) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${FIRE_CHECK_PATH}`, { method: "POST", body });
      try {
        const reply = await post(JSON.stringify({ checkId: check.id }));
        expect(reply.status).toBe(200);
        const { runId } = (await reply.json()) as { runId: string };

        expect(await finished(db, runId)).toMatchObject({ customerId: "noodle", trigger: "schedule", status: "success", platform: "local" });
        expect(await statusOf(db, check.id)).toBe("fired");
        const prompt = run.mock.calls[0]![0].prompt;
        expect(prompt).toContain("BE-1");
        expect(prompt).not.toContain("BE-9");

        // Firing again answers with the same run and starts nothing.
        const again = await post(JSON.stringify({ checkId: check.id }));
        expect(await again.json()).toEqual({ runId });
        expect(run).toHaveBeenCalledOnce();

        expect((await post(JSON.stringify({ checkId: "nope" }))).status).toBe(404);
        expect((await post(JSON.stringify({ id: check.id }))).status).toBe(400);
        expect((await post("{not json")).status).toBe(400);
      } finally {
        scheduler.stop();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  it("answers 409 for a failed check, which never got a run", async () => {
    await withTestDb("monitor_fire", async (db) => {
      await addCustomer(db, "noodle", ["BE-1"]);
      const { deps, run, scheduler } = setup(db);
      const check = await scheduler.schedule({ customerId: "noodle", runAt: PAST });
      await db.update(scheduledChecks).set({ status: "failed" }).where(eq(scheduledChecks.id, check.id));
      const server = createInboundServer({ ...deps, mail: createMail({}), scheduler });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const reply = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${FIRE_CHECK_PATH}`, { method: "POST", body: JSON.stringify({ checkId: check.id }) });
        expect(reply.status).toBe(409);
        expect(run).not.toHaveBeenCalled();
      } finally {
        scheduler.stop();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});

describe("startScheduledRun", () => {
  it("starts a run from a due check on a cron tick", async () => {
    await withTestDb("monitor_fire", async (db) => {
      await addCustomer(db, "noodle", ["BE-1"]);
      const { scheduler } = setup(db);
      try {
        const check = await scheduler.schedule({ customerId: "noodle", runAt: PAST });
        await scheduler.fireDue();
        const [row] = await db.select().from(runs);
        expect(row).toMatchObject({ customerId: "noodle", trigger: "schedule" });
        await finished(db, row!.id);
        expect(await statusOf(db, check.id)).toBe("fired");
      } finally {
        scheduler.stop();
      }
    });
  });

  it("does not start a second run for a check requeued after a crash", async () => {
    await withTestDb("monitor_fire", async (db) => {
      await addCustomer(db, "noodle", ["BE-1"]);
      const { run, scheduler } = setup(db);
      try {
        const check = await scheduler.schedule({ customerId: "noodle", runAt: PAST });
        await scheduler.fire(check.id);
        await db.update(scheduledChecks).set({ status: "pending" }).where(eq(scheduledChecks.id, check.id));
        await scheduler.fire(check.id);
        const rows = await db.select().from(runs);
        expect(rows).toHaveLength(1);
        await finished(db, rows[0]!.id);
        expect(run).toHaveBeenCalledOnce();
      } finally {
        scheduler.stop();
      }
    });
  });

  it("fails the check and starts nothing for a customer with no accounts", async () => {
    await withTestDb("monitor_fire", async (db) => {
      await addCustomer(db, "noodle", []);
      const { run, scheduler } = setup(db);
      try {
        const check = await scheduler.schedule({ customerId: "noodle", runAt: PAST });
        await expect(scheduler.fire(check.id)).rejects.toThrow(/no accounts/);
        expect(await statusOf(db, check.id)).toBe("failed");
        expect(await db.select().from(runs)).toEqual([]);
        expect(run).not.toHaveBeenCalled();
      } finally {
        scheduler.stop();
      }
    });
  });
});
