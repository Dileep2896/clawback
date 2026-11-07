import type { Db } from "@bill-fighter/db/client";
import { customers, scheduledChecks } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "./scheduler.ts";

const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2999-01-01T00:00:00Z");

const addCustomer = async (db: Db) =>
  (
    await db
      .insert(customers)
      .values({ name: "c", contactName: "c", contactEmail: "c@billfighter.local", contactPhone: "+15550001111" })
      .returning()
  )[0]!.id;

const statusOf = async (db: Db, id: string) =>
  (await db.select().from(scheduledChecks).where(eq(scheduledChecks.id, id)))[0]!.status;

afterEach(() => vi.restoreAllMocks());

describe("scheduler", () => {
  it("fires only due checks, and each once when two ticks race", () =>
    withTestDb("scheduler_due", async (db) => {
      const customerId = await addCustomer(db);
      const scheduler = createScheduler(db);
      const due = await scheduler.schedule({ customerId, runAt: PAST });
      const later = await scheduler.schedule({ customerId, runAt: FUTURE });
      const handler = vi.fn(async () => {});
      scheduler.onFire(handler);
      scheduler.stop();

      await Promise.all([scheduler.fireDue(), scheduler.fireDue()]);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(await statusOf(db, due.id)).toBe("fired");
      expect(await statusOf(db, later.id)).toBe("pending");
    }));

  it("marks a throwing handler failed, rethrows on a manual fire, and does not retry", () =>
    withTestDb("scheduler_fail", async (db) => {
      const scheduler = createScheduler(db);
      const check = await scheduler.schedule({ customerId: await addCustomer(db), runAt: PAST });
      const handler = vi.fn(async () => {
        throw new Error("boom");
      });
      scheduler.onFire(handler);
      scheduler.stop();

      await expect(scheduler.fire(check.id)).rejects.toThrow("boom");
      expect(await statusOf(db, check.id)).toBe("failed");
      await scheduler.fireDue();
      expect(handler).toHaveBeenCalledTimes(1);
    }));

  it("holds 'running' during the handler, then 'fired' after it", () =>
    withTestDb("scheduler_claim", async (db) => {
      const scheduler = createScheduler(db);
      const check = await scheduler.schedule({ customerId: await addCustomer(db), runAt: PAST });
      let during = "";
      scheduler.onFire(async () => {
        during = await statusOf(db, check.id);
      });
      scheduler.stop();

      await scheduler.fire(check.id);
      expect(during).toBe("running");
      expect(await statusOf(db, check.id)).toBe("fired");
    }));

  it("after a restart, fires a row left 'running' but not a 'failed' one", () =>
    withTestDb("scheduler_restart", async (db) => {
      const customerId = await addCustomer(db);
      const scheduler = createScheduler(db);
      const interrupted = await scheduler.schedule({ customerId, runAt: PAST });
      const failed = await scheduler.schedule({ customerId, runAt: new Date(PAST.getTime() + 1000) });
      await db.update(scheduledChecks).set({ status: "running" }).where(eq(scheduledChecks.id, interrupted.id));
      await db.update(scheduledChecks).set({ status: "failed" }).where(eq(scheduledChecks.id, failed.id));

      const handler = vi.fn(async () => {});
      scheduler.onFire(handler);
      scheduler.stop();
      await scheduler.fireDue();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: interrupted.id }));
      expect(await statusOf(db, interrupted.id)).toBe("fired");
      expect(await statusOf(db, failed.id)).toBe("failed");
    }));

  it("claims nothing while recovery fails, then recovers on the next tick and fires the running row", () =>
    withTestDb("scheduler_recovery_retry", async (db) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const customerId = await addCustomer(db);
      const scheduler = createScheduler(db);
      const interrupted = await scheduler.schedule({ customerId, runAt: PAST });
      const pending = await scheduler.schedule({ customerId, runAt: new Date(PAST.getTime() + 1000) });
      await db.update(scheduledChecks).set({ status: "running" }).where(eq(scheduledChecks.id, interrupted.id));

      vi.spyOn(db, "update").mockImplementationOnce(
        () => ({ set: () => ({ where: () => Promise.reject(new Error("db down")) }) }) as never,
      );
      const handler = vi.fn(async () => {});
      scheduler.onFire(handler);
      scheduler.stop();

      await scheduler.fireDue();
      expect(handler).not.toHaveBeenCalled();
      expect(await statusOf(db, interrupted.id)).toBe("running");
      expect(await statusOf(db, pending.id)).toBe("pending");

      await scheduler.fireDue();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: interrupted.id }));
      expect(await statusOf(db, interrupted.id)).toBe("fired");
      expect(await statusOf(db, pending.id)).toBe("fired");
    }));

  it("does not requeue a running handler on a second onFire", () =>
    withTestDb("scheduler_refire", async (db) => {
      const scheduler = createScheduler(db);
      const check = await scheduler.schedule({ customerId: await addCustomer(db), runAt: PAST });
      scheduler.onFire(async () => {
        scheduler.onFire(async () => {});
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(await statusOf(db, check.id)).toBe("running");
      });
      scheduler.stop();
      await scheduler.fire(check.id);
    }));

  it("keeps going after one bad check on a tick", () =>
    withTestDb("scheduler_tick", async (db) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const customerId = await addCustomer(db);
      const scheduler = createScheduler(db);
      await scheduler.schedule({ customerId, runAt: PAST });
      await scheduler.schedule({ customerId, runAt: new Date(PAST.getTime() + 1000) });
      const handler = vi.fn(async () => {
        throw new Error("boom");
      });
      scheduler.onFire(handler);
      scheduler.stop();

      await scheduler.fireDue();
      expect(handler).toHaveBeenCalledTimes(2);
    }));

  it("refuses an unknown id and a fire with no handler", () =>
    withTestDb("scheduler_refuse", async (db) => {
      const scheduler = createScheduler(db);
      await expect(scheduler.fire("nope")).rejects.toThrow(/no onFire handler/);
      scheduler.onFire(async () => {});
      scheduler.stop();
      await expect(scheduler.fire("nope")).rejects.toThrow(/No scheduled check/);
    }));
});
