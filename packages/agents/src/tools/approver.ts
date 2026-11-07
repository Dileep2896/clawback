import { dollars } from "@bill-fighter/core/rules/input";
import { findingTotals } from "@bill-fighter/core/rules/totals";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { accounts, actions, customers, findings, locations } from "@bill-fighter/db/schema";
import { getPlatform, platformName } from "@bill-fighter/platform/factory";
import type { Approval, ApprovalGate, Mail, Sms } from "@bill-fighter/platform/types";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { cancellableLines, customerOfRun } from "../findings.ts";
import { amountsIn, assertNoOwnNumbers } from "../letters/numbers.ts";
import { defineTool } from "../tool-wrapper.ts";
import { letterActionId, oneAtATime } from "./filer.ts";

type Deps = {
  db: Db;
  gate: () => Promise<ApprovalGate>;
  sms: () => Promise<Sms>;
  mail: () => Promise<Mail>;
  mode: () => "local" | "naive";
};

const view = ({ id, actionIds, status, summary }: Approval) => ({ approvalId: id, actionIds, status, summary });

const counted = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Everything an approval releases, counted from the bundle's own actions, so the owner is told all of it whatever the model wrote.
 * A kind with no wording refuses the request: an owner must never approve an action this text leaves out.
 */
export function bundleLines(bundled: { kind: string; payloadJson: unknown }[]) {
  const countOf = (kind: string) => bundled.filter((action) => action.kind === kind).length;
  const lines: string[] = [];
  // Cancel actions are the call's own lines, so the call's sentence covers them.
  const unworded = bundled.find(({ kind }) => !["claim", "plan_change", "call", "cancel", "letter", "invoice"].includes(kind));
  if (unworded) throw new Error(`The approval text has no wording for a ${unworded.kind} action, so nothing was requested`);

  if (countOf("claim") > 0) lines.push(`We will file ${counted(countOf("claim"), "Rule 17.1 refund claim")}.`);
  if (countOf("plan_change") > 0) lines.push(`We will file ${counted(countOf("plan_change"), "Rule 12 rate change request")}.`);
  for (const { kind, payloadJson } of bundled) {
    if (kind !== "call") continue;
    const { cancelLines, promoAccounts } = payloadJson as { cancelLines: string[]; promoAccounts: string[] };
    const parts = [];
    if (cancelLines.length > 0) parts.push(`cancel ${counted(cancelLines.length, "unused line")}`);
    if (promoAccounts.length > 0) parts.push(`ask to restore ${counted(promoAccounts.length, "promo rate")}`);
    lines.push(`On the BayTel call we will ${parts.join(" and ")}.`);
  }
  if (countOf("letter") > 0) lines.push(`We have drafted ${counted(countOf("letter"), "cancellation letter")} for those lines.`);
  if (countOf("invoice") > 0) lines.push("We will invoice you for our fee.");
  return lines;
}

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
      handler: oneAtATime(async ({ actionIds, summary }, { runId }) => {
        const approvals = await gate();
        const existing = await approvals.get(runId);
        if (existing) return view(existing);
        assertNoOwnNumbers(summary);

        const customer = await customerOfRun(db, runId);
        return db.transaction(async (tx) => {
          // Held to the end, so run_audit cannot change these findings while the bundle that rests on them is being created.
          await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customer.id)).for("update");
          const proposed = await tx
            .select({ finding: findings, accountNumber: accounts.accountNumber })
            .from(findings)
            .innerJoin(accounts, eq(findings.accountId, accounts.id))
            .where(and(eq(findings.customerId, customer.id), eq(findings.status, "proposed")));

          // One at a time: a transaction has one connection.
          const cancels = [];
          for (const { finding } of proposed) {
            const lines = await cancellableLines(tx, finding);
            if (lines.length > 0) cancels.push({ findingId: finding.id, lines });
          }
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
            const [lowest] = await tx
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
          const letters = (await tx.select({ id: actions.id, findingId: actions.findingId, kind: actions.kind, payloadJson: actions.payloadJson }).from(actions).where(like(actions.id, `letter-${runId}-%`)))
            .filter((letter) => letter.findingId && letter.id === letterActionId(runId, letter.findingId));
          const own = [...created.map((action) => action.id!), ...letters.map((letter) => letter.id)];
          const foreign = actionIds.filter((id) => !own.includes(id));
          if (foreign.length > 0) throw new Error(`Run ${runId}: not actions of this run: ${foreign.join(", ")}`);
          // Approval freezes the letters and filing needs evidence, so a bundled letter without it could never be filed.
          const unattached = letters.filter((letter) => !(letter.payloadJson as { evidencePath?: string } | null)?.evidencePath).map((letter) => letter.id);
          if (unattached.length > 0) throw new Error(`Run ${runId}: nothing was requested. Call attach_evidence for these letters, then request approval again: ${unattached.join(", ")}`);

          if (created.length > 0) await tx.insert(actions).values(created).onConflictDoNothing({ target: actions.id });
          const figures = `Refund to claim: ${dollars(totals.refundCents)}. Yearly savings: ${dollars(totals.annualSavingsCents)}.`;
          const scope = bundleLines([...created, ...letters].map(({ kind, payloadJson }) => ({ kind, payloadJson })));
          // Code-built lines first: the Approval panel shows the top of the summary, and these must never fall below the fold.
          return view(await approvals.createBundle({ runId, actionIds: own, summary: `${[...scope, figures].join("\n")}\n\n${summary}` }, tx));
        });
      }),
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
        // After the check, because these counts come from the bundle and not from the model.
        const bundled = approval ? await db.select({ kind: actions.kind, payloadJson: actions.payloadJson }).from(actions).where(inArray(actions.id, approval.actionIds)) : [];
        const text = [body, bundleLines(bundled).join("\n")].filter(Boolean).join("\n\n");
        // naïve refuses outbound SMS, so there the same request goes by email (phase 12).
        if (mode() === "naive") {
          const { contactEmail } = await customerOfRun(db, runId);
          const { id } = await (await mail()).send({ to: contactEmail, subject: "Your approval is needed", text });
          return { id, channel: "email" };
        }
        const { id } = await (await sms()).send({ to: process.env.OWNER_PHONE_SIM || "+15550001111", body: text });
        return { id, channel: "sms" };
      },
    }),
  ];
}

export default approverTools();
