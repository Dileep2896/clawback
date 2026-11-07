import { setTimeout as sleep } from "node:timers/promises";
import type { Db } from "@bill-fighter/db/client";
import { boardCards } from "@bill-fighter/db/schema";
import type { Llm } from "@bill-fighter/platform/types";
import { RUN_CARD_AGENT } from "@bill-fighter/shared/run-card";
import { and, eq } from "drizzle-orm";

export const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;
// One turn of a simulated call. A parse takes longer, so the time limit is set here and not on every Llm call.
const CALL_TURN_TIMEOUT_MS = 60_000;

const SAVED = "Everything done so far is saved.";
export const INTERRUPTED = `Stopped because the server was shut down while this run was working. ${SAVED}`;

const textOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Only for work that is safe to repeat. Gated actions never go through here: their own guards handle a repeat by the model. */
export async function withRetry<T>(work: () => Promise<T>, { retryIf, delayMs = RETRY_DELAY_MS }: { retryIf: (error: unknown) => boolean; delayMs?: number }): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= RETRY_ATTEMPTS || !retryIf(error)) throw error;
      await sleep(delayMs);
    }
  }
}

export const isTimeout = (error: unknown) => error instanceof Error && error.name === "TimeoutError";

/** Playwright's limits, the collector's own wait and a portal that is down. A refused login or an allowlist refusal is none of these. */
export const isPortalTimeout = (error: unknown) => isTimeout(error) || /Timeout \d+ms exceeded|Timed out waiting|net::ERR_/.test(textOf(error));

/** A simulated call turn writes nothing until the model has answered, so a timed-out turn can simply be asked again. */
export const retryingCallLlm = (llm: Llm): Llm => ({
  structured: (input, schema) => withRetry(() => llm.structured({ ...input, timeoutMs: CALL_TURN_TIMEOUT_MS }, schema), { retryIf: isTimeout }),
});

/**
 * Puts a fixed message on the board and in the dashboard header, and never a provider's raw text, which can hold ids.
 * A repeat by the model adds nothing. A failure here is only logged, so it cannot hide the failure being reported.
 */
export async function reportProblem(db: Db, runId: string, title: string) {
  try {
    const onBoard = await db.select({ id: boardCards.id }).from(boardCards).where(and(eq(boardCards.runId, runId), eq(boardCards.agent, RUN_CARD_AGENT), eq(boardCards.title, title)));
    if (onBoard.length === 0) await db.insert(boardCards).values({ runId, agent: RUN_CARD_AGENT, title, status: "blocked" });
  } catch (error) {
    console.error(`Run ${runId}: could not report "${title}":`, error);
  }
}

/** Reports why the run stopped, and shows that the work in progress will not finish. No row is removed. */
export async function reportStop(db: Db, runId: string, message: string) {
  await reportProblem(db, runId, message);
  await db
    .update(boardCards)
    .set({ status: "blocked" })
    .where(and(eq(boardCards.runId, runId), eq(boardCards.status, "doing")))
    .catch((error: unknown) => console.error(`Run ${runId}: could not block its open cards:`, error));
}

export function stopMessage(status: string, reason = "") {
  if (status === "over_budget") return `Stopped because the estimated cost reached the run budget. The cost is an estimate, and it can include the full 5 minute charge for a dial that timed out. ${SAVED}`;
  if (/model did not answer/i.test(reason)) return `Stopped because the model did not answer in time. ${SAVED}`;
  if (/rate limit/i.test(reason)) return `Stopped because the Claude plan rate limit was reached. ${SAVED}`;
  if (/refusing to run|login|auth/i.test(reason)) return `Stopped because the Claude login check failed. ${SAVED}`;
  return `Stopped because of an error, which is in the server log. ${SAVED}`;
}
