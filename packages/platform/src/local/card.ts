import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { ledger } from "@bill-fighter/db/schema";
import { eq, sql } from "drizzle-orm";
import type { Card } from "../types.ts";
import { usdFromEnv } from "./env-usd.ts";

/** A mock of the one company card: the cap covers all its spend so far, as a real card's hard limit does. */
export function createCard(db: Db): Card {
  return {
    async charge({ customerId, amountCents, description }) {
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new Error(`Invalid card charge of ${amountCents} cents`);
      }
      const capCents = Math.round(usdFromEnv("NAIVE_CARD_CAP_USD", 5) * 100);

      return db.transaction(async (tx) => {
        // Held until commit, so two charges cannot both read the same total and together pass the cap.
        // 7106001 is an arbitrary key used only here.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7106001)`);
        const [spent] = await tx
          .select({ cents: sql<number>`coalesce(sum(${ledger.amountCents}), 0)::int` })
          .from(ledger)
          .where(eq(ledger.kind, "card_spend"));
        const total = spent!.cents + amountCents;
        if (total > capCents) {
          throw new Error(`Card charge refused: ${total} cents would pass the ${capCents} cent cap`);
        }
        const [row] = await tx
          .insert(ledger)
          .values({ customerId, kind: "card_spend", amountCents, description })
          .returning({ id: ledger.id });
        return { ledgerId: row!.id };
      });
    },
  };
}

export default createCard(sharedDb);
