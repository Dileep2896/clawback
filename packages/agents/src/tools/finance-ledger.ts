import { countsInLedger, customerKeepsCents, feeCents } from "@bill-fighter/core/money/fee";
import { totalsByKind } from "@bill-fighter/core/rules/totals";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { customers, findings, ledger } from "@bill-fighter/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { customerOfRun } from "../findings.ts";
import { defineTool } from "../tool-wrapper.ts";

const REFUND_CLAIMED = "Claimed, due only when granted";
const SAVINGS_FILED = "Filed, due only when granted";
const SAVINGS_WON = "First year savings";

export function financeLedgerTools({ db = sharedDb }: { db?: Db } = {}) {
  return [
    defineTool({
      name: "record_savings",
      description:
        "Records the refund and first year savings of every finding that counts, and our fee, in the ledger. Takes no input: it reads the findings and what the calls confirmed. Safe to repeat. Returns the totals to report.",
      // Strict: a model that supplies an amount or picks a finding is refused rather than having it dropped silently.
      inputSchema: z.strictObject({}),
      targets: () => [],
      async handler(_input, { runId }) {
        const { id: customerId } = await customerOfRun(db, runId);
        return db.transaction(async (tx) => {
          // Held to the end, so overlapping uses cannot write a fee from a total that misses the other's rows.
          const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId)).for("update");
          const found = await tx.select().from(findings).where(eq(findings.customerId, customerId));

          for (const finding of found.filter(countsInLedger)) {
            const { id: findingId, refundCents, annualSavingsCents, status } = finding;
            if (refundCents > 0) {
              await tx.insert(ledger).values({ customerId, findingId, kind: "refund", amountCents: refundCents, description: REFUND_CLAIMED }).onConflictDoNothing();
            }
            if (annualSavingsCents > 0) {
              const description = status === "won" ? SAVINGS_WON : SAVINGS_FILED;
              // Only the wording moves on: a recorded amount stays as it was.
              await tx
                .insert(ledger)
                .values({ customerId, findingId, kind: "savings", amountCents: annualSavingsCents, description })
                .onConflictDoUpdate({ target: [ledger.findingId, ledger.kind], set: { description } });
            }
          }

          const rows = await tx.select({ kind: ledger.kind, amountCents: ledger.amountCents }).from(ledger).where(eq(ledger.customerId, customerId));
          const totals = totalsByKind(rows);
          const refundCents = totals.get("refund") ?? 0;
          const annualSavingsCents = totals.get("savings") ?? 0;
          const fee = feeCents({ refundCents, annualSavingsCents, sharePct: customer!.savingsSharePct });

          // shortcut: one row over the customer's whole ledger, so a later monthly run grows it. Bill the difference, or key the row by run, once a second run is invoiced.
          await tx
            .insert(ledger)
            .values({ id: `fee-${customerId}`, customerId, kind: "fee", amountCents: fee, description: `${customer!.savingsSharePct}% of refund and first year savings` })
            .onConflictDoUpdate({ target: ledger.id, set: { amountCents: sql`excluded.amount_cents`, description: sql`excluded.description` } });

          return { refundCents, annualSavingsCents, feeCents: fee, customerKeepsCents: customerKeepsCents({ refundCents, annualSavingsCents, feeCents: fee }) };
        });
      },
    }),
  ];
}

export default financeLedgerTools();
