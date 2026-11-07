import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { accounts, actions, bills, findings } from "@bill-fighter/db/schema";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { ApprovalGate } from "@bill-fighter/platform/types";
import { FindingEvidence } from "@bill-fighter/shared/finding";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { cancellableLines, customerOfRun } from "../findings.ts";
import { assertNoOwnNumbers } from "../letters/numbers.ts";
import { LETTER_KINDS, mergeEvidence, renderLetter } from "../letters/render.ts";
import { defineTool } from "../tool-wrapper.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

type Deps = { db: Db; gate: () => Promise<Pick<ApprovalGate, "get">>; lettersDir: string };

type LetterPayload = { letterPath: string; evidencePath?: string };

export const letterActionId = (runId: string, findingId: string) => `letter-${runId}-${findingId}`;

export function filerTools({
  db = sharedDb,
  gate = () => getPlatform().approvalGate(),
  lettersDir = join(REPO_ROOT, "data/letters"),
}: Partial<Deps> = {}) {
  const save = async (actionId: string, suffix: string, pdf: Uint8Array) => {
    await mkdir(lettersDir, { recursive: true });
    const file = join(lettersDir, `${encodeURIComponent(actionId)}${suffix}.pdf`);
    await writeFile(file, pdf);
    return relative(REPO_ROOT, file);
  };

  const fileTool = (name: string, kind: "claim" | "plan_change", description: string) =>
    defineTool({
      name,
      description,
      inputSchema: z.object({ actionId: z.string().min(1) }),
      targets: () => [],
      async handler({ actionId }, { runId }) {
        // The runtime gates this too, but its release is global: only this run's own approval may file for it.
        const approval = await (await gate()).get(runId);
        if (approval?.status !== "approved" || !approval.actionIds.includes(actionId)) {
          throw new Error(`Action ${actionId} is not in an approved bundle of run ${runId}`);
        }
        const [action] = await db.select().from(actions).where(eq(actions.id, actionId));
        if (action?.kind !== kind || !action.findingId) throw new Error(`Action ${actionId} is not a ${kind} action`);
        if (!(action.payloadJson as LetterPayload | null)?.evidencePath) throw new Error(`Action ${actionId} has no evidence attached`);
        const findingId = action.findingId;
        // Only status changes: nothing is sent, and the account keeps its rate until the provider changes it.
        await db.transaction(async (tx) => {
          await tx.update(actions).set({ status: "done" }).where(eq(actions.id, actionId));
          // A finding the call or the provider has moved on stays where it is.
          await tx
            .update(findings)
            .set({ status: "filed" })
            .where(and(eq(findings.id, findingId), inArray(findings.status, ["proposed", "approved"])));
        });
        return { actionId, findingId, status: "done" };
      },
    });

  return [
    defineTool({
      name: "draft_letter",
      description:
        "Draft letters as PDFs, one per finding: Rule 17.1 claims, Rule 12 requests and cancellations of unused lines. You write the wording, with no digits or amounts except the rule names. The tool fills in every number from the finding.",
      inputSchema: z.object({
        letters: z.array(z.object({ findingId: z.string().min(1), wording: z.string().min(1).max(4000) })).min(1),
      }),
      targets: () => [],
      async handler({ letters }, { runId }) {
        // What the owner approved must stay what gets filed.
        if (await (await gate()).get(runId)) throw new Error(`Run ${runId} has already asked for approval, so its letters can no longer change`);
        const customer = await customerOfRun(db, runId);

        // Everything is checked and rendered before anything is written, so a refusal leaves no partial batch.
        const rendered = [];
        for (const { findingId, wording } of letters) {
          assertNoOwnNumbers(wording);
          const [row] = await db
            .select({ finding: findings, accountNumber: accounts.accountNumber })
            .from(findings)
            .innerJoin(accounts, eq(findings.accountId, accounts.id))
            .where(and(eq(findings.id, findingId), eq(findings.customerId, customer.id)));
          if (!row) throw new Error(`Finding ${findingId} is not a finding of this run's customer`);
          const { finding, accountNumber } = row;
          const kind = LETTER_KINDS[finding.type as keyof typeof LETTER_KINDS];
          if (!kind) throw new Error(`Findings of type ${finding.type} get no letter`);
          if (finding.type === "unusedLines" && (await cancellableLines(db, finding)).length === 0) {
            throw new Error(`Finding ${findingId} is not a line we may cancel. Alarm lines are never cancelled.`);
          }
          const pdf = await renderLetter({
            finding: { ...finding, evidence: FindingEvidence.parse(finding.evidenceJson) },
            accountNumber,
            customerName: customer.name,
            contactName: customer.contactName,
            wording,
          });
          rendered.push({ findingId, kind, pdf });
        }

        return Promise.all(
          rendered.map(async ({ findingId, kind, pdf }) => {
            const actionId = letterActionId(runId, findingId);
            const path = await save(actionId, "", pdf);
            const payloadJson: LetterPayload = { letterPath: path };
            await db
              .insert(actions)
              .values({ id: actionId, findingId, kind, payloadJson, status: "proposed" })
              .onConflictDoUpdate({ target: actions.id, set: { payloadJson } });
            return { actionId, findingId, kind, path };
          }),
        );
      },
    }),

    defineTool({
      name: "attach_evidence",
      description: "Attach the bills that prove each finding to its drafted letter. Takes every letter action id at once. Safe to repeat.",
      inputSchema: z.object({ actionIds: z.array(z.string().min(1)).min(1) }),
      targets: () => [],
      async handler({ actionIds }, { runId }) {
        // What the owner was asked to approve must stay what gets filed, so check before any file is written.
        const bundled = (await (await gate()).get(runId))?.actionIds ?? [];
        const frozen = actionIds.filter((actionId) => bundled.includes(actionId));
        if (frozen.length > 0) throw new Error(`Run ${runId} has already asked for approval, so the evidence of ${frozen.join(", ")} can no longer change`);
        return Promise.all(
          actionIds.map(async (actionId) => {
            const [row] = await db
              .select({ action: actions, finding: findings })
              .from(actions)
              .innerJoin(findings, eq(actions.findingId, findings.id))
              .where(eq(actions.id, actionId));
            // Exact, not a prefix: run "run" must not rewrite the frozen PDF of run "run-2".
            if (!row || actionId !== letterActionId(runId, row.finding.id)) throw new Error(`Action ${actionId} is not a letter of this run`);
            const { letterPath } = row.action.payloadJson as LetterPayload;
            const { billIds, billLineIds, phoneLineIds } = FindingEvidence.parse(row.finding.evidenceJson);
            const rows = await db.select().from(bills).where(inArray(bills.id, billIds));
            const billPdfs = await Promise.all(
              billIds.map(async (billId) => {
                const pdfPath = rows.find((bill) => bill.id === billId)?.pdfPath;
                if (!pdfPath) throw new Error(`Bill ${billId} has no PDF on file`);
                try {
                  return await readFile(resolve(REPO_ROOT, pdfPath));
                } catch (cause) {
                  throw new Error(`Bill ${billId}: cannot read its PDF at ${pdfPath}`, { cause });
                }
              }),
            );
            // Always from the bare letter, so repeating this cannot double the pages.
            const merged = await mergeEvidence(await readFile(resolve(REPO_ROOT, letterPath)), billPdfs);
            const evidencePath = await save(actionId, "-with-evidence", merged);
            const payloadJson = { letterPath, evidencePath, billIds, billLineIds, phoneLineIds };
            await db.update(actions).set({ payloadJson }).where(eq(actions.id, actionId));
            return { actionId, evidencePath, billIds };
          }),
        );
      },
    }),

    fileTool("submit_claim", "claim", "File an approved Rule 17.1 claim. Records it on our own tables and contacts nobody."),
    fileTool("change_rate_plan", "plan_change", "File an approved Rule 12 rate change request. Records it on our own tables and contacts nobody."),
  ];
}

export default filerTools();
