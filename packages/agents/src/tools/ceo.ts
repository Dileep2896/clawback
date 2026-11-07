import { dollars } from "@bill-fighter/core/rules/input";
import { findingTotals, totalsByKind } from "@bill-fighter/core/rules/totals";
import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { findings, ledger } from "@bill-fighter/db/schema";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { ApprovalGate, Board, Mail } from "@bill-fighter/platform/types";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { customerOfRun } from "../findings.ts";
import { assertNoOwnNumbers } from "../letters/numbers.ts";
import { defineTool } from "../tool-wrapper.ts";

type Deps = {
  db: Db;
  board: () => Promise<Board>;
  mail: () => Promise<Mail>;
  gate: () => Promise<Pick<ApprovalGate, "get">>;
};

const LEDGER_LABELS = {
  refund: "Refund claimed",
  savings: "Yearly savings recorded",
  fee: "Our fee",
  invoice: "Invoiced",
  card_spend: "Card spend",
} as const;

/** Every number in the email comes from here, read from findings and the ledger. */
async function summaryFigures(db: Db, customerId: string) {
  const found = await db
    .select({ refundCents: findings.refundCents, annualSavingsCents: findings.annualSavingsCents })
    .from(findings)
    .where(and(eq(findings.customerId, customerId), ne(findings.status, "rejected")));
  const { refundCents, annualSavingsCents } = findingTotals(found);
  const rows = await db.select({ kind: ledger.kind, amountCents: ledger.amountCents }).from(ledger).where(eq(ledger.customerId, customerId));
  const ledgerLines = [...totalsByKind(rows)].map(([kind, cents]) => `${LEDGER_LABELS[kind]}: ${dollars(cents)}`);
  return [`Refund found: ${dollars(refundCents)}`, `Yearly savings found: ${dollars(annualSavingsCents)}`, ...ledgerLines];
}

export function ceoTools({
  db = sharedDb,
  board = () => getPlatform().board(),
  mail = () => getPlatform().mail(),
  gate = () => getPlatform().approvalGate(),
}: Partial<Deps> = {}) {
  return [
    defineTool({
      name: "board_update",
      description:
        "Keep the board current. With no cardId, creates a card from agent (the member doing the work) and title. With a cardId, moves that card to status.",
      inputSchema: z.object({
        cardId: z.string().min(1).optional(),
        agent: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        status: z.enum(["todo", "doing", "done", "blocked"]).optional(),
      }),
      targets: () => [],
      async handler({ cardId, agent, title, status }, { runId }) {
        const cards = await board();
        if (!cardId) {
          if (!agent || !title) throw new Error("A new card needs agent and title");
          const { id, status: created } = await cards.create({ runId, agent, title, status });
          return { cardId: id, agent, title, status: created };
        }
        if (!status) throw new Error("Moving a card needs a status");
        if (!(await cards.list(runId)).some((card) => card.id === cardId)) throw new Error(`Card ${cardId} is not on this run's board`);
        const moved = await cards.move(cardId, status);
        return { cardId, agent: moved.agent, title: moved.title, status: moved.status };
      },
    }),

    defineTool({
      name: "send_email",
      description:
        "Email the owner the summary. Write the subject and wording with no digits or amounts: the tool adds every figure from the findings and the ledger. Refused while an approval is pending.",
      inputSchema: z.object({ to: z.string().min(1), subject: z.string().min(1).max(200), wording: z.string().min(1).max(4000) }),
      targets: ({ to }) => [{ kind: "email", value: to }],
      async handler({ to, subject, wording }, { runId }) {
        if ((await (await gate()).get(runId))?.status === "pending") throw new Error("The approval is still pending, so no summary can go out yet");
        assertNoOwnNumbers(subject);
        assertNoOwnNumbers(wording);
        const { id: customerId } = await customerOfRun(db, runId);
        const figures = await summaryFigures(db, customerId);
        const { id } = await (await mail()).send({ to, subject, text: `${wording}\n\n${figures.join("\n")}` });
        return { id, to, figures };
      },
    }),
  ];
}

export default ceoTools();
