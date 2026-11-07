import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { accounts, actions, calls, findings, phoneLines } from "@bill-fighter/db/schema";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { Budget } from "@bill-fighter/platform/types";
import { runLiveCall } from "@bill-fighter/voice/live/caller/engine";
import { LINE_NUMBER } from "@bill-fighter/voice/live/line/script";
import { type CallOutcome, extractOutcome } from "@bill-fighter/voice/outcome";
import { type CallPlan, lineKey, runSimCall } from "@bill-fighter/voice/sim/engine";
import type { TranscriptRow } from "@bill-fighter/voice/transcript";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { reportProblem, retryingCallLlm } from "../retry.ts";
import { defineTool } from "../tool-wrapper.ts";

type EngineCall = { actionId: string; plan: CallPlan; onCost: (usd: number) => void; fallbackReason?: string };
type Engine = (call: EngineCall) => Promise<{ callId: string }>;

export type NegotiatorDeps = { db: Db; budget: () => Promise<Budget>; sim: Engine; live: Engine };

const CALL_PLAN: z.ZodType<CallPlan> = z.object({
  accountNumber: z.string().min(1),
  cancelLines: z.array(z.string().min(1)),
  promoAccounts: z.array(z.string().min(1)),
});

const textOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function voiceMode() {
  const mode = process.env.VOICE_MODE || "sim";
  // A typo must not place a call of the wrong kind.
  if (mode !== "sim" && mode !== "live") throw new Error(`Unknown VOICE_MODE "${mode}": expected sim or live`);
  return mode;
}

export function negotiatorTools({ db, budget, sim, live }: NegotiatorDeps) {
  async function place(call: EngineCall) {
    if (voiceMode() === "sim") return { ...(await sim(call)), mode: "sim" as const };
    try {
      return { ...(await live(call)), mode: "live" as const };
    } catch (error) {
      const fallbackReason = textOf(error);
      return { ...(await sim({ ...call, fallbackReason })), mode: "sim" as const, fallbackReason };
    }
  }

  async function callOnce(actionId: string, runId: string) {
    const [action] = await db.select().from(actions).where(eq(actions.id, actionId));
    // The gate only proves the id is in an approved bundle, not that a call is what was approved.
    if (action?.kind !== "call") throw new Error(`call_provider needs a call action, and ${actionId} is not one`);

    // A retry returns the finished call, so a repeated tool use cannot place a second one.
    const [finished] = await db
      .select()
      .from(calls)
      .where(and(eq(calls.actionId, actionId), isNotNull(calls.outcomeJson)));
    if (finished) return { callId: finished.id, mode: finished.mode, outcome: finished.outcomeJson, repeated: true };

    const plan = CALL_PLAN.parse(action.payloadJson);
    let costUsd = 0;
    try {
      const placed = await place({ actionId, plan, onCost: (usd) => (costUsd += usd) }).catch(async (error: unknown) => {
        await reportProblem(db, runId, "The provider call could not be completed, so no cancellation or credit was confirmed.");
        throw error;
      });
      const [call] = await db.select().from(calls).where(eq(calls.id, placed.callId));
      const outcome = extractOutcome(call!.transcriptJson as TranscriptRow[]);
      // Only accounts the owner approved can be won, whatever was said on the call.
      const restored = outcome.credits.filter((account) => plan.promoAccounts.includes(account));
      await db.transaction(async (tx) => {
        await tx.update(calls).set({ outcomeJson: outcome }).where(eq(calls.id, placed.callId));
        await tx.update(actions).set({ status: "done" }).where(eq(actions.id, actionId));
        if (restored.length === 0) return;
        // shortcut: account numbers are matched across customers, like the sim's line lookup. Scope by customer if the demo ever has two.
        const accountIds = tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.accountNumber, restored));
        await tx
          .update(findings)
          .set({ status: "won" })
          .where(and(eq(findings.type, "promoExpiry"), inArray(findings.accountId, accountIds)));
      });
      return { ...placed, outcome };
    } finally {
      // A failed budget write is only logged: it must not hide a call that happened, or the error of one that failed.
      if (costUsd > 0) await budget().then((b) => b.add(runId, costUsd)).catch((error) => console.warn(`Call cost not recorded: ${textOf(error)}`));
    }
  }

  // shortcut: covers one process, and the run is one process. Claim in the database if calls ever start from two.
  const running = new Map<string, ReturnType<typeof callOnce>>();

  return [
    defineTool({
      name: "call_provider",
      description:
        "Calls the provider line about an approved call action, says the required disclosure, and saves the outcome: the lines the rep cancelled, the promo accounts restored (credits) and the ticket. Returns callId for cancel_service.",
      inputSchema: z.object({ actionId: z.string().min(1) }),
      // Fixed in code, so the model cannot choose who is dialled.
      targets: () => [{ kind: "phone", value: LINE_NUMBER }],
      handler({ actionId }, { runId }) {
        // No await between the lookup and the set, so two overlapping uses cannot both start a call.
        const shared = running.get(actionId);
        if (shared) return shared;
        const call = callOnce(actionId, runId).finally(() => running.delete(actionId));
        running.set(actionId, call);
        return call;
      },
    }),

    defineTool({
      name: "cancel_service",
      description:
        "Records one approved line cancellation. The line comes from the cancel action's finding, and it is recorded only if the outcome of the given call confirms it. Alarm lines are always refused.",
      inputSchema: z.object({ actionId: z.string().min(1), callId: z.string().min(1) }),
      targets: () => [],
      async handler({ actionId, callId }) {
        const [action] = await db
          .select({ kind: actions.kind, findingId: findings.id, type: findings.type, evidence: findings.evidenceJson })
          .from(actions)
          .leftJoin(findings, eq(actions.findingId, findings.id))
          .where(eq(actions.id, actionId));
        if (action?.kind !== "cancel" || action.type !== "unusedLines") {
          throw new Error(`cancel_service needs a cancel action on an unused line finding, and ${actionId} is not one`);
        }

        const { phoneLineIds } = z.object({ phoneLineIds: z.array(z.string()).length(1) }).parse(action.evidence);
        const [line] = await db.select().from(phoneLines).where(eq(phoneLines.id, phoneLineIds[0]!));
        if (!line) throw new Error(`Action ${actionId}: its line is not on file`);
        if (line.purpose === "alarm") throw new Error(`Line ${line.number} is an alarm line and is never cancelled`);

        const [call] = await db.select({ outcome: calls.outcomeJson }).from(calls).where(eq(calls.id, callId));
        const outcome = call?.outcome as CallOutcome | null | undefined;
        if (!outcome) throw new Error(`Call ${callId} has no outcome, so nothing can be recorded`);
        if (!outcome.cancelled_lines.some((number) => lineKey(number) === lineKey(line.number))) {
          throw new Error(`The outcome of call ${callId} does not confirm line ${line.number}, so it was not recorded`);
        }

        await db.transaction(async (tx) => {
          await tx.update(findings).set({ status: "won" }).where(eq(findings.id, action.findingId!));
          await tx.update(actions).set({ status: "done" }).where(eq(actions.id, actionId));
        });
        return { recorded: line.number };
      },
    }),
  ];
}

// Everything that can fail waits for a handler, so importing this file never throws.
export default negotiatorTools({
  db: sharedDb,
  budget: () => getPlatform().budget(),
  sim: async (call) => runSimCall({ db: sharedDb, llm: retryingCallLlm(await getPlatform().llm()), ...call }),
  live: (call) => runLiveCall({ db: sharedDb, ...call }),
});
