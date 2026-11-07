import { splitFee } from "@bill-fighter/core/money/fee";
import { dollars } from "@bill-fighter/core/rules/input";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { actions, findings, ledger } from "@bill-fighter/db/schema";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { ApprovalGate, Card } from "@bill-fighter/platform/types";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import Stripe from "stripe";
import { z } from "zod";
import { customerOfRun } from "../findings.ts";
import { reportProblem } from "../retry.ts";
import { stripeTestKey } from "../stripe-key.ts";
import { defineTool } from "../tool-wrapper.ts";
import { oneAtATime } from "./filer.ts";

type Deps = {
  db: Db;
  gate: () => Promise<Pick<ApprovalGate, "get">>;
  stripe: (key: string) => Pick<Stripe, "customers" | "invoices" | "invoiceItems">;
  card: () => Promise<Card>;
};

const DAYS_UNTIL_DUE = 30;

const CARD_PAYLOAD = z.object({ amountCents: z.number().int().positive(), description: z.string().min(1) });

/** The SDK retries connection errors and 5xx itself, with the same idempotency key. Its default 80 s per try would stall the stage. */
export const stripeClient = (key: string, httpClient?: Stripe.HttpClient) => new Stripe(key, { timeout: 15_000, maxNetworkRetries: 2, ...(httpClient ? { httpClient } : {}) });

export function financeInvoiceTools({
  db = sharedDb,
  gate = () => getPlatform().approvalGate(),
  stripe = (key) => stripeClient(key),
  card = () => getPlatform().card(),
}: Partial<Deps> = {}) {
  const reportingStripeFailure =
    <I, O>(handler: (input: I, ctx: { runId: string }) => Promise<O>) =>
    async (input: I, ctx: { runId: string }): Promise<O> => {
      try {
        return await handler(input, ctx);
      } catch (error) {
        if (error instanceof Stripe.errors.StripeError) await reportProblem(db, ctx.runId, "Stripe did not create the invoice, so none was recorded. The fee is still in the ledger.");
        throw error;
      }
    };

  // The runtime gates these too, but its release is global: only this run's own approval may spend for it.
  async function approvedAction(actionId: string, runId: string) {
    const approval = await (await gate()).get(runId);
    if (approval?.status !== "approved" || !approval.actionIds.includes(actionId)) {
      throw new Error(`Action ${actionId} is not in an approved bundle of run ${runId}`);
    }
    const [action] = await db.select().from(actions).where(eq(actions.id, actionId));
    return action;
  }

  return [
    defineTool({
      name: "create_invoice",
      description:
        "Invoices our fee in Stripe test mode for an approved invoice action. The amount comes from the ledger, so call record_savings first. Nothing is emailed. Safe to repeat. Returns the invoice id and amounts to report.",
      // Strict: a model that supplies an amount is refused rather than having it dropped silently.
      inputSchema: z.strictObject({ actionId: z.string().min(1) }),
      // Contacts nobody: the invoice is finalized and never sent.
      targets: () => [],
      handler: oneAtATime(reportingStripeFailure(async ({ actionId }: { actionId: string }, { runId }) => {
        const key = stripeTestKey();
        const action = await approvedAction(actionId, runId);
        if (action?.kind !== "invoice" || actionId !== `invoice-${runId}`) throw new Error(`create_invoice needs this run's invoice action, and ${actionId} is not it`);

        const customer = await customerOfRun(db, runId);
        const invoiced = await db.select().from(ledger).where(and(eq(ledger.customerId, customer.id), eq(ledger.kind, "invoice")));
        const done = invoiced.find((row) => row.id === actionId);
        if (done) return { invoiceId: done.externalId, amountCents: done.amountCents, description: done.description, repeated: true };
        // The fee row covers the customer's whole ledger, so a later run's invoice would bill all of it again.
        if (invoiced.length > 0) throw new Error(`Customer ${customer.id} was already invoiced by ${invoiced[0]!.id}, and invoicing a later run is not built, so nothing was billed`);

        const [fee] = await db.select().from(ledger).where(and(eq(ledger.customerId, customer.id), eq(ledger.kind, "fee")));
        if (!fee || fee.amountCents <= 0) throw new Error(`Customer ${customer.id} has no fee in the ledger to invoice. Call record_savings first.`);

        const won = await db
          .select({ amountCents: ledger.amountCents })
          .from(ledger)
          .innerJoin(findings, eq(ledger.findingId, findings.id))
          .where(and(eq(ledger.customerId, customer.id), inArray(ledger.kind, ["refund", "savings"]), eq(findings.status, "won")));
        const { dueNowCents, dueWhenGrantedCents } = splitFee({
          totalFeeCents: fee.amountCents,
          wonCents: won.reduce((sum, row) => sum + row.amountCents, 0),
          sharePct: customer.savingsSharePct,
        });

        const api = stripe(key);
        // shortcut: Stripe may drop these keys after 24 hours, so a crash here and a retry a day later could make a second invoice. Look it up by metadata.action_id if retries ever wait that long.
        const stripeCustomer = await api.customers.create({ name: customer.name, email: customer.contactEmail, metadata: { customer_id: customer.id } }, { idempotencyKey: `${actionId}-customer` });
        const memo =
          dueWhenGrantedCents > 0
            ? `Due today: ${dollars(dueNowCents)}. The other ${dollars(dueWhenGrantedCents)} is due only when the refund is granted, so please do not pay it yet.`
            : `Due today: ${dollars(dueNowCents)}.`;
        const draft = await api.invoices.create(
          { customer: stripeCustomer.id, collection_method: "send_invoice", days_until_due: DAYS_UNTIL_DUE, auto_advance: false, description: memo, metadata: { action_id: actionId } },
          { idempotencyKey: actionId },
        );
        const lines = [
          { suffix: "due-now", amount: dueNowCents, description: "Fee on confirmed savings, due now" },
          { suffix: "when-granted", amount: dueWhenGrantedCents, description: "Fee on the claimed refund and filed savings, due only when the refund is granted" },
        ];
        for (const { suffix, amount, description } of lines.filter((line) => line.amount > 0)) {
          await api.invoiceItems.create({ customer: stripeCustomer.id, invoice: draft.id, amount, currency: "usd", description }, { idempotencyKey: `${actionId}-${suffix}` });
        }
        const invoice = await api.invoices.finalizeInvoice(draft.id, { auto_advance: false }, { idempotencyKey: `${actionId}-finalize` });
        if (invoice.total !== fee.amountCents) throw new Error(`Stripe invoice ${invoice.id} totals ${invoice.total} cents, not the ${fee.amountCents} cent fee, so it was not recorded`);

        const description = `Stripe test invoice: ${dollars(dueNowCents)} due now, ${dollars(dueWhenGrantedCents)} due when the refund is granted`;
        await db.transaction(async (tx) => {
          await tx.insert(ledger).values({ id: actionId, customerId: customer.id, kind: "invoice", amountCents: fee.amountCents, externalId: invoice.id, description }).onConflictDoNothing({ target: ledger.id });
          await tx.update(actions).set({ status: "done" }).where(eq(actions.id, actionId));
        });
        return { invoiceId: invoice.id, amountCents: fee.amountCents, dueNowCents, dueWhenGrantedCents, description, hostedInvoiceUrl: invoice.hosted_invoice_url };
      })),
    }),

    defineTool({
      name: "card_pay",
      description: "Pays one small approved expense on the company card. The amount and what it is for come from the approved action. Safe to repeat.",
      // Strict: a model that supplies an amount is refused rather than having it dropped silently.
      inputSchema: z.strictObject({ actionId: z.string().min(1) }),
      targets: () => [],
      handler: oneAtATime(async ({ actionId }, { runId }) => {
        const action = await approvedAction(actionId, runId);
        if (action?.kind !== "card_pay") throw new Error(`card_pay needs a card_pay action, and ${actionId} is not one`);
        const payload = CARD_PAYLOAD.parse(action.payloadJson);
        // Card.charge has no idempotency of its own, so the action's status is what stops a second charge.
        if (action.status === "done") return { actionId, repeated: true };

        const customer = await customerOfRun(db, runId);
        const cardApi = await card();
        // Claimed before charging and never released: a claim left behind may mean money moved, so only a human can clear it.
        const [claimed] = await db
          .update(actions)
          .set({ status: "running" })
          .where(and(eq(actions.id, actionId), notInArray(actions.status, ["running", "done"])))
          .returning({ id: actions.id });
        if (!claimed) throw new Error(`Card payment ${actionId} was started but is not marked done, so it may already have charged. Nothing was charged now. A human must check the card.`);

        const { ledgerId } = await cardApi.charge({ customerId: customer.id, ...payload });
        await db.update(actions).set({ status: "done" }).where(eq(actions.id, actionId));
        return { actionId, ledgerId };
      }),
    }),
  ];
}

export default financeInvoiceTools();
