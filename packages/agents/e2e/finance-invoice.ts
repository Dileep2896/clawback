// Checks the finance-invoice acceptance list against real Stripe test mode, with the real demo figures. Creates one test invoice each run, and emails nobody.
// Run: pnpm exec tsx --env-file-if-exists=.env packages/agents/e2e/finance-invoice.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { actions, approvals, findings, ledger } from "@bill-fighter/db/schema";
import { seedRun, withTestDb } from "@bill-fighter/db/test-db";
import { createApprovalGate } from "@bill-fighter/platform/local/approval-gate";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { stripeTestKey } from "../src/stripe-key.ts";
import { financeInvoiceTools } from "../src/tools/finance-invoice.ts";
import { financeLedgerTools } from "../src/tools/finance-ledger.ts";

const FEE = 1_024_961;
const DUE_NOW = 248_400;
const DUE_WHEN_GRANTED = 776_561;

// Unique, so a run of this check never meets the Stripe keys of an earlier one.
const runId = randomUUID();
const actionId = `invoice-${runId}`;
const ctx = { runId, agent: "finance" };

let exitCode = 1;
try {
  await withTestDb("finance_invoice_e2e", async (db) => {
    const { customerId } = await seedRun(db, runId);
    const seed = (id: string, type: string, status: "filed" | "won", refundCents: number, annualSavingsCents: number) =>
      db.insert(findings).values({ id, customerId, type, status, title: id, explanation: id, evidenceJson: {}, refundCents, annualSavingsCents, confidence: 0.9 });
    await seed("line", "unusedLines", "won", 0, 828_000);
    await seed("meter", "meterMultiplierJump", "filed", 1_260_000, 0);
    await seed("rate", "rateOptimization", "filed", 0, 1_328_538);
    const recorded = (await financeLedgerTools({ db })[0]!.handler({}, ctx)) as { feeCents: number };
    assert.equal(recorded.feeCents, FEE, "record_savings wrote the real fee");

    await db.insert(actions).values({ id: actionId, findingId: null, kind: "invoice", payloadJson: { customerId }, status: "proposed" });
    const tool = financeInvoiceTools({ db, gate: async () => createApprovalGate(db) })[0]!;

    await assert.rejects(tool.handler({ actionId }, ctx) as Promise<unknown>, /not in an approved bundle/, "blocked without approval");
    await db.insert(approvals).values({ runId, actionIds: [actionId], summary: "e2e", status: "approved" });

    const first = (await tool.handler({ actionId }, ctx)) as { invoiceId: string; amountCents: number; dueNowCents: number; dueWhenGrantedCents: number };
    assert.deepEqual([first.amountCents, first.dueNowCents, first.dueWhenGrantedCents], [FEE, DUE_NOW, DUE_WHEN_GRANTED]);

    const stripe = new Stripe(stripeTestKey());
    const invoice = await stripe.invoices.retrieve(first.invoiceId);
    assert.equal(invoice.livemode, false, "test mode");
    assert.equal(invoice.status, "open", "finalized");
    assert.equal(invoice.total, FEE, "the invoice equals the ledger fee to the cent");
    assert.equal(invoice.metadata?.action_id, actionId);
    assert.match(invoice.description ?? "", /Due today: \$2,484\.00\. The other \$7,765\.61 is due only when the refund is granted/);
    const lines = invoice.lines.data.map(({ amount, description }) => ({ amount, description }));
    assert.equal(lines.length, 2);
    assert.equal(lines.find(({ amount }) => amount === DUE_NOW)?.description, "Fee on confirmed savings, due now");
    assert.match(lines.find(({ amount }) => amount === DUE_WHEN_GRANTED)?.description ?? "", /due only when the refund is granted/);

    const repeat = (await tool.handler({ actionId }, ctx)) as { invoiceId: string; repeated: boolean };
    assert.deepEqual([repeat.invoiceId, repeat.repeated], [first.invoiceId, true], "a retry finds the ledger row");

    // A crash just before the ledger write: only Stripe's idempotency keys can stop a second invoice now.
    await db.delete(ledger).where(eq(ledger.id, actionId));
    const retried = (await tool.handler({ actionId }, ctx)) as { invoiceId: string };
    assert.equal(retried.invoiceId, first.invoiceId, "the idempotency key returned the same invoice");
    const found = await stripe.invoices.list({ customer: invoice.customer as string });
    assert.equal(found.data.length, 1, "Stripe holds one invoice for this customer");

    console.info(`Invoice ${first.invoiceId}: total ${invoice.total} cents, ${lines.length} lines, status ${invoice.status}`);
    console.info(`Test dashboard: https://dashboard.stripe.com/test/invoices/${first.invoiceId}`);
  });
  console.info("finance-invoice e2e passed");
  exitCode = 0;
} catch (error) {
  console.error(error);
}
process.exit(exitCode);
