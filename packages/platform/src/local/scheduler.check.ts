import assert from "node:assert/strict";
import { customers } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { createScheduler } from "./scheduler.ts";

export default async function check() {
  await withTestDb("scheduler", async (db) => {
    const rows = await db
      .insert(customers)
      .values({ name: "c", contactName: "c", contactEmail: "c@billfighter.local", contactPhone: "+15550001111" })
      .returning();
    const customerId = rows[0]!.id;
    const scheduler = createScheduler(db);
    try {
      const runAt = new Date(Date.now() + 86_400_000);
      const first = await scheduler.schedule({ customerId, runAt });
      const repeat = await scheduler.schedule({ customerId, runAt });
      assert.equal(repeat.id, first.id, "a repeat schedule made a second check");

      const fired: string[] = [];
      scheduler.onFire(async (check) => {
        fired.push(check.id);
      });
      await scheduler.fire(first.id);
      await scheduler.fire(first.id);
      assert.deepEqual(fired, [first.id], "fire ran the handler other than once");
    } finally {
      scheduler.stop();
    }
  });
}
