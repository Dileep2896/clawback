import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runAudit } from "@bill-fighter/core/rules/index";
import { compareRates } from "@bill-fighter/core/rules/rate-optimization";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { billLines, bills, findings, phoneLines } from "@bill-fighter/db/schema";
import type { Finding } from "@bill-fighter/shared/finding";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { PARSED_DIR } from "../audit-input.ts";
import { customerAccounts, customerBills, loadCustomerAuditInput, runPaths, RUNS_DIR } from "../customer-data.ts";
import { createParseCache } from "../parse-cache.ts";
import { defineTool } from "../tool-wrapper.ts";

const customerInput = z.strictObject({ customerId: z.string().min(1) });
// Error text goes to the model, so a mass failure must not fill its context with hundreds of ids.
const MAX_LISTED = 20;

const listed = (items: string[]) =>
  items.slice(0, MAX_LISTED).join(", ") + (items.length > MAX_LISTED ? ` and ${items.length - MAX_LISTED} more` : "");

/** Same customer, rule, account and evidence gives the same id, so running the audit again cannot duplicate a finding. */
function findingId({ customerId, type, accountId, evidence }: Finding) {
  const key = [customerId, type, accountId, ...[evidence.billIds, evidence.billLineIds, evidence.phoneLineIds].map((ids) => [...ids].sort())];
  return `finding-${createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 24)}`;
}

export function createAuditorTools({ db, root = RUNS_DIR, parsedDir = PARSED_DIR }: { db: Db; root?: string; parsedDir?: string }) {
  return [
    defineTool({
      name: "parse_bill",
      description: "Reads every bill filed for the customer in this run from the parse cache. A bill with no cached parse fails the call.",
      inputSchema: customerInput,
      targets: () => [],
      async handler({ customerId }, { runId }) {
        const { storedBills } = runPaths(runId, root);
        // No llm, in any mode: a miss fails visibly and can never spend. New bills go through scripts/parse-bills.ts first.
        const cache = createParseCache({ dir: parsedDir });
        const rows = await customerBills(db, customerId);
        if (rows.length === 0) throw new Error(`Customer ${customerId} has no bills on file`);

        const parsed: { id: string; json: unknown }[] = [];
        const needsReview: string[] = [];
        const missed: string[] = [];
        const notFiled: string[] = [];
        let cached = 0;
        let firstMissReason: string | undefined;
        for (const { id } of rows) {
          let pdf: Buffer;
          try {
            pdf = await readFile(join(storedBills, `${id}.pdf`));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              notFiled.push(id);
            } else {
              firstMissReason ??= error instanceof Error ? error.message : String(error);
              missed.push(id);
            }
            continue;
          }
          try {
            const entry = await cache.parse(pdf, id);
            if (entry.cached) cached++;
            if (entry.status !== "parsed") needsReview.push(id);
            // Null clears any earlier parse, so a bill now under review cannot reach the audit.
            parsed.push({ id, json: entry.status === "parsed" ? entry.bill : null });
          } catch (error) {
            firstMissReason ??= error instanceof Error ? error.message : String(error);
            missed.push(id);
          }
        }

        await db.transaction(async (tx) => {
          for (const { id, json } of parsed) await tx.update(bills).set({ parsedJson: json }).where(eq(bills.id, id));
          // Null clears any earlier parse, so run_audit refuses a bill this run could not parse.
          await tx.update(bills).set({ parsedJson: null }).where(inArray(bills.id, [...missed, ...notFiled]));
        });

        if (missed.length + notFiled.length > 0) {
          throw new Error(
            `parse_bill: ${cached} cached, but ${missed.length} had no usable cached parse and ${notFiled.length} were never filed.` +
              (missed.length ? ` No parse: ${listed(missed)}. First reason: ${firstMissReason}` : "") +
              (notFiled.length ? ` Not filed: ${listed(notFiled)}.` : ""),
          );
        }
        return { parsed: parsed.length, cached, fresh: parsed.length - cached, needsReview };
      },
    }),
    defineTool({
      name: "price_usage",
      description: "Prices each electric account's metered usage on its current schedule and every schedule it could move to.",
      inputSchema: customerInput,
      targets: () => [],
      async handler({ customerId }) {
        const input = await loadCustomerAuditInput(db, customerId);
        const accounts = input.accounts
          .filter((account) => account.serviceType === "electric")
          .map((account) => {
            const comparison = compareRates(input, account.id);
            if (!comparison) return { accountId: account.id, comparable: false };
            const { current, alternatives, peakKw, heldKw } = comparison;
            return {
              accountId: account.id,
              comparable: true,
              schedule: current.schedule,
              annualCents: current.annualCents,
              alternatives: alternatives.map(({ schedule, annualCents }) => ({ schedule, annualCents })),
              peakKw,
              heldKw,
            };
          });
        return { accounts };
      },
    }),
    defineTool({
      name: "run_audit",
      description: "Runs every audit rule over the customer's parsed bills and usage, and saves the findings.",
      inputSchema: customerInput,
      targets: () => [],
      async handler({ customerId }) {
        const run = runAudit(await loadCustomerAuditInput(db, customerId));

        // Evidence is JSON, which no foreign key checks. A finding must only point at rows that exist.
        const billIds = (await customerBills(db, customerId)).map((bill) => bill.id);
        const accountIds = (await customerAccounts(db, customerId)).map((account) => account.id);
        const [lineRows, phoneRows] = await Promise.all([
          db.select({ id: billLines.id }).from(billLines).where(inArray(billLines.billId, billIds)),
          db.select({ id: phoneLines.id }).from(phoneLines).where(inArray(phoneLines.accountId, accountIds)),
        ]);
        const exists = { bill: new Set(billIds), line: new Set(lineRows.map((row) => row.id)), phone: new Set(phoneRows.map((row) => row.id)) };
        const dangling = run.findings.flatMap(({ evidence }) => [
          ...evidence.billIds.filter((id) => !exists.bill.has(id)),
          ...evidence.billLineIds.filter((id) => !exists.line.has(id)),
          ...evidence.phoneLineIds.filter((id) => !exists.phone.has(id)),
        ]);
        if (dangling.length > 0) throw new Error(`run_audit saved nothing: evidence points at ids not on file: ${listed(dangling)}`);

        const rows = run.findings.map((finding) => {
          const { evidence, ...columns } = finding;
          return { ...columns, id: findingId(finding), evidenceJson: evidence };
        });
        await db.transaction(async (tx) => {
          if (rows.length > 0) {
            await tx
              .insert(findings)
              .values(rows)
              .onConflictDoUpdate({
                target: findings.id,
                // Not status: rerunning the audit must not undo an approval.
                set: {
                  title: sql`excluded.title`,
                  explanation: sql`excluded.explanation`,
                  evidenceJson: sql`excluded.evidence_json`,
                  refundCents: sql`excluded.refund_cents`,
                  annualSavingsCents: sql`excluded.annual_savings_cents`,
                  confidence: sql`excluded.confidence`,
                },
              });
          }
          // The audit no longer reports these. Updated, not deleted, so any actions keep their finding.
          await tx
            .update(findings)
            .set({ status: "rejected" })
            .where(and(eq(findings.customerId, customerId), eq(findings.status, "proposed"), notInArray(findings.id, rows.map((row) => row.id))));
        });
        return {
          findings: rows.map(({ id, type, accountId, title, refundCents, annualSavingsCents, confidence }) => ({
            id,
            type,
            accountId,
            title,
            refundCents,
            annualSavingsCents,
            confidence,
          })),
          refundCents: run.refundCents,
          annualSavingsCents: run.annualSavingsCents,
        };
      },
    }),
  ];
}

export default createAuditorTools({ db: sharedDb });
