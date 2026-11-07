import assert from "node:assert/strict";
import { ledger } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { eq } from "drizzle-orm";
import adapter, { createCard } from "./card.ts";
import { usdFromEnv } from "./env-usd.ts";

export default async function check() {
  assert.equal(typeof adapter.charge, "function");
  await withTestDb("check_card", async (db) => {
    const { customerId } = await seedRun(db, "run");
    const card = createCard(db);
    const { ledgerId } = await card.charge({ customerId, amountCents: 100, description: "check" });
    const [row] = await db.select().from(ledger).where(eq(ledger.id, ledgerId));
    assert.equal(row?.kind, "card_spend");
    const overCap = Math.round(usdFromEnv("NAIVE_CARD_CAP_USD", 5) * 100);
    await assert.rejects(card.charge({ customerId, amountCents: overCap, description: "check" }), /refused/);
  });
}
