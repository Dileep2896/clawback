import { customers, scheduledChecks } from "@bill-fighter/db/schema";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "./scheduler.ts";
import { type Db, withTempDb } from "./temp-db.ts";

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
    withTempDb("scheduler_due", async (db) => {
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
    withTempDb("scheduler_fail", async (db) => {
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

  it("keeps going after one bad check on a tick", () =>
    withTempDb("scheduler_tick", async (db) => {
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
    withTempDb("scheduler_refuse", async (db) => {
      const scheduler = createScheduler(db);
      await expect(scheduler.fire("nope")).rejects.toThrow(/no onFire handler/);
      scheduler.onFire(async () => {});
      scheduler.stop();
      await expect(scheduler.fire("nope")).rejects.toThrow(/No scheduled check/);
    }));
});
