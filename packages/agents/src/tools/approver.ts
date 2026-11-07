import { dollars } from "@bill-fighter/core/rules/input";
import { findingTotals } from "@bill-fighter/core/rules/totals";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { accounts, actions, findings, locations } from "@bill-fighter/db/schema";
import { getPlatform, platformName } from "@bill-fighter/platform/factory";
import type { Approval, ApprovalGate, Mail, Sms } from "@bill-fighter/platform/types";
import { and, asc, eq, like } from "drizzle-orm";
import { z } from "zod";
import { cancellableLines, customerOfRun } from "../findings.ts";
import { amountsIn, assertNoOwnNumbers } from "../letters/numbers.ts";
import { defineTool } from "../tool-wrapper.ts";
import { letterActionId } from "./filer.ts";

type Deps = {
  db: Db;
  gate: () => Promise<ApprovalGate>;
  sms: () => Promise<Sms>;
  mail: () => Promise<Mail>;
  mode: () => "local" | "naive";
};

const view = ({ id, actionIds, status, summary }: Approval) => ({ approvalId: id, actionIds, status, summary });

export function approverTools({
  db = sharedDb,
  gate = () => getPlatform().approvalGate(),
  sms = () => getPlatform().sms(),
  mail = () => getPlatform().mail(),
  mode = platformName,
}: Partial<Deps> = {}) {
  return [
    defineTool({
      name: "request_approval",
      description:
        "Ask the owner once to approve everything in this run. Give every action id and a plain summary with no digits or amounts: the tool adds the totals. It also creates the call, cancel and invoice actions. A second call returns the same request.",
      inputSchema: z.object({ actionIds: z.array(z.string().min(1)), summary: z.string().min(1).max(2000) }),
      targets: () => [],
      async handler({ actionIds, summary }, { runId }) {
        const approvals = await gate();
        const existing = await approvals.get(runId);
        if (existing) return view(existing);
        assertNoOwnNumbers(summary);

        const customer = await customerOfRun(db, runId);
        const proposed = await db
          .select({ finding: findings, accountNumber: accounts.accountNumber })
          .from(findings)
          .innerJoin(accounts, eq(findings.accountId, accounts.id))
          .where(and(eq(findings.customerId, customer.id), eq(findings.status, "proposed")));

        const cancels = (
          await Promise.all(
            proposed.map(async ({ finding }) => ({ findingId: finding.id, lines: await cancellableLines(db, finding) })),
          )
        ).filter(({ lines }) => lines.length > 0);
        const cancelLines = cancels.flatMap(({ lines }) => lines.map((line) => line.number));
        const promoAccounts = proposed.filter(({ finding }) => finding.type === "promoExpiry").map(({ accountNumber }) => accountNumber).sort();
        const totals = findingTotals(proposed.map(({ finding }) => finding));

        // Fixed ids, so a retry or a race creates nothing twice.
        const created: (typeof actions.$inferInsert)[] = cancels.map(({ findingId }) => ({
          id: `cancel-${runId}-${findingId}`,
          findingId,
          kind: "cancel",
          status: "proposed",
        }));
        if (cancelLines.length + promoAccounts.length > 0) {
          const [lowest] = await db
            .select({ accountNumber: accounts.accountNumber })
            .from(accounts)
            .innerJoin(locations, eq(accounts.locationId, locations.id))
            .where(and(eq(locations.customerId, customer.id), eq(accounts.provider, "baytel")))
            .orderBy(asc(accounts.accountNumber))
            .limit(1);
          if (!lowest) throw new Error(`Customer ${customer.id} has no BayTel account to call about`);
          created.push({
            id: `call-${runId}`,
            findingId: null,
            kind: "call",
            payloadJson: { accountNumber: lowest.accountNumber, cancelLines, promoAccounts },
            status: "proposed",
          });
        }
        if (totals.refundCents + totals.annualSavingsCents > 0) {
          // No amount: finance-invoice computes the fee.
          created.push({ id: `invoice-${runId}`, findingId: null, kind: "invoice", payloadJson: { customerId: customer.id }, status: "proposed" });
        }

        // A run gets one approval, so a letter the model forgot to list could never be filed.
        // The LIKE only narrows: run "run" also matches run "run-2", so the exact id decides.
        const letters = (await db.select({ id: actions.id, findingId: actions.findingId }).from(actions).where(like(actions.id, `letter-${runId}-%`)))
          .filter((letter) => letter.findingId && letter.id === letterActionId(runId, letter.findingId));
        const own = [...created.map((action) => action.id!), ...letters.map((letter) => letter.id)];
        const foreign = actionIds.filter((id) => !own.includes(id));
        if (foreign.length > 0) throw new Error(`Run ${runId}: not actions of this run: ${foreign.join(", ")}`);

        if (created.length > 0) await db.insert(actions).values(created).onConflictDoNothing({ target: actions.id });
        const figures = `Refund to claim: ${dollars(totals.refundCents)}. Yearly savings: ${dollars(totals.annualSavingsCents)}.`;
        return view(await approvals.createBundle({ runId, actionIds: own, summary: `${summary}\n\n${figures}` }));
      },
    }),

    defineTool({
      name: "send_sms",
      description:
        "Tell the owner the approval request is waiting. It always goes to the owner, so give only the message. Any amount must be copied exactly from the request's summary.",
      // Strict: a model that names a recipient is refused rather than having it dropped silently.
      inputSchema: z.strictObject({ body: z.string().min(1).max(1000) }),
      // Contacts only the configured owner, so the model has no target to check.
      targets: () => [],
      async handler({ body }, { runId }) {
        const approval = await (await gate()).get(runId);
        assertNoOwnNumbers(body, amountsIn(approval?.summary ?? ""));
        // naïve refuses outbound SMS, so there the same request goes by email (phase 12).
        if (mode() === "naive") {
          const { contactEmail } = await customerOfRun(db, runId);
          const { id } = await (await mail()).send({ to: contactEmail, subject: "Your approval is needed", text: body });
          return { id, channel: "email" };
        }
        const { id } = await (await sms()).send({ to: process.env.OWNER_PHONE_SIM || "+15550001111", body });
        return { id, channel: "sms" };
      },
    }),
  ];
}

export default approverTools();
