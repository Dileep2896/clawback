import type { Db } from "@bill-fighter/db/client";
import { calls } from "@bill-fighter/db/schema";
import { allowlistFromEnv } from "@bill-fighter/shared/allowlist";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type CallOutcome, extractOutcome } from "../../outcome.ts";
import { type CallPlan, checkPlan, lineKey } from "../../sim/engine.ts";
import { appendRow, closeCall, transcriptRow, type TranscriptRow } from "../../transcript.ts";
import { LINE_NUMBER, TICKET_NUMBER } from "../line/script.ts";
import { CALLER_NUMBER, callVariables, MAX_CALL_MS } from "./agent.ts";
import { RetellItem, retellToRows } from "./normalize.ts";
import { REQUEST_TIMEOUT_MS, type Retell, retellClient, RetellHttpError } from "./retell.ts";

// From the spike's billed lines (voice-design.md).
const RETELL_USD_PER_MIN = 0.0882;
const RETELL_FLAT_USD = 0.0208;
const VAPI_USD_PER_MIN = 0.07;

const RetellCall = z.looseObject({
  call_status: z.string(),
  disconnection_reason: z.string().optional(),
  start_timestamp: z.number().optional(),
  end_timestamp: z.number().optional(),
  recording_url: z.string().optional(),
  transcript_with_tool_calls: z.array(RetellItem).optional(),
  transcript_object: z.array(RetellItem).optional(),
  call_cost: z.looseObject({ combined_cost: z.number() }).optional(),
});
type RetellCall = z.infer<typeof RetellCall>;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const secondsOf = (call: RetellCall) => (call.start_timestamp && call.end_timestamp ? (call.end_timestamp - call.start_timestamp) / 1000 : 0);

// Retell can answer with an empty list before the transcript is ready, so empty counts as not there yet.
const transcriptOf = (call: RetellCall) => (call.transcript_with_tool_calls?.length ? call.transcript_with_tool_calls : (call.transcript_object ?? []));
const isSettled = (call: RetellCall) => Boolean(transcriptOf(call).length && call.recording_url && call.call_cost);

async function waitForEnd(retell: Retell, retellId: string, timing: { pollMs: number; deadlineMs: number; settleMs: number }) {
  const deadline = Date.now() + timing.deadlineMs;
  // Polling stops early enough that the stop request also finishes inside the deadline.
  const pollUntil = deadline - Math.min(REQUEST_TIMEOUT_MS, timing.deadlineMs / 2);
  const left = (until: number) => Math.max(until - Date.now(), 0);
  const limitBy = (until: number) => Math.min(REQUEST_TIMEOUT_MS, left(until));
  const read = async (until: number) => RetellCall.parse(await retell("GET", `/v2/get-call/${retellId}`, undefined, limitBy(until)));
  while (left(pollUntil) > 0) {
    await pause(Math.min(timing.pollMs, left(pollUntil)));
    let call: RetellCall;
    try {
      call = await read(pollUntil);
    } catch (error) {
      // The call is running and being paid for either way, so one bad read must not end the wait.
      console.warn(`Reading Retell call ${retellId} failed: ${textOf(error)}`);
      continue;
    }
    if (call.call_status !== "ended") {
      if (call.call_status === "not_connected" || call.call_status === "error") return call;
      continue;
    }
    // The docs do not say when the cost and recording arrive, so wait a little for them.
    const settleBy = Math.min(Date.now() + timing.settleMs, deadline);
    while (!isSettled(call) && left(settleBy) > 0) {
      await pause(Math.min(timing.pollMs, left(settleBy)));
      call = await read(settleBy).catch(() => call);
    }
    return call;
  }
  await retell("POST", `/v2/stop-call/${retellId}`, undefined, limitBy(deadline)).catch((error) => console.warn(`Stopping Retell call ${retellId} failed: ${textOf(error)}`));
  return null;
}

// What this call costs goes to the run budget and the log. shortcut: Vapi's part is a per-minute estimate, and the real figure comes from `cli.ts readback`. Read it in the engine if the budget ever needs to be exact.
function chargeCall(call: RetellCall | null, retellId: string, onCost: (usd: number) => void) {
  const seconds = call ? secondsOf(call) : MAX_CALL_MS / 1000;
  const minutes = seconds / 60;
  const retellCents = call?.call_cost?.combined_cost;
  const retellUsd = retellCents !== undefined ? retellCents / 100 : seconds > 0 ? minutes * RETELL_USD_PER_MIN + RETELL_FLAT_USD : 0;
  const vapiUsd = minutes * VAPI_USD_PER_MIN;
  console.log(
    `Live call ${retellId}: ${seconds.toFixed(1)} s, Retell $${retellUsd.toFixed(4)}${retellCents === undefined ? " (estimate)" : ""}, Vapi about $${vapiUsd.toFixed(4)}`,
  );
  if (retellUsd + vapiUsd > 0) onCost(retellUsd + vapiUsd);
}

// `user_hangup` is how a good call ends here (the line hangs up), so a call is judged on what was said, not on why it ended.
function problemWith(call: RetellCall, rows: TranscriptRow[]): string | null {
  if (call.call_status !== "ended") return `the call ended as ${call.call_status}: ${call.disconnection_reason ?? "no reason given"}`;
  const first = rows[0];
  const disclosed = first?.role === "agent" && first.kind === "speech" && (first.content === DISCLOSURE_LINE || first.content.startsWith(`${DISCLOSURE_LINE} `));
  if (!disclosed) return "the call did not open with the disclosure";
  if (!extractOutcome(rows).ticket) return `the call ended with no ticket number: ${call.disconnection_reason ?? "no reason given"}`;
  return null;
}

/** What stops a saved row passing the live acceptance test. The engine accepts a call with a disclosure and a ticket, and this asks for everything in the plan as well. */
export function liveRowProblems(row: { mode: string; recordingUrl: string | null; outcomeJson: unknown } | undefined, plan: CallPlan): string[] {
  if (row?.mode !== "live") return ["no live row was saved"];
  const outcome = row.outcomeJson as CallOutcome | null;
  if (!outcome) return ["the live row has no saved outcome"];
  return [
    ...plan.cancelLines.map(lineKey).filter((line) => !outcome.cancelled_lines.includes(line)).map((line) => `line ${line} is not in the outcome`),
    ...plan.promoAccounts.filter((account) => !outcome.credits.includes(account)).map((account) => `promo account ${account} is not in the outcome`),
    ...(outcome.ticket === TICKET_NUMBER ? [] : [`the ticket is ${outcome.ticket}, not ${TICKET_NUMBER}`]),
    ...(row.recordingUrl ? [] : ["the live row has no recording URL"]),
  ];
}

/**
 * One real call to the line, and its saved transcript. Throws on any failure, which makes call_provider fall back to sim, labelled.
 * Dials at most once per action, ever: the row goes in before the dial, so a retry or a crash cannot pay for a second call.
 */
export async function runLiveCall(input: {
  db: Db;
  actionId: string;
  plan: CallPlan;
  onCost: (usd: number) => void;
  fetchImpl?: typeof fetch;
  agentId?: string;
  pollMs?: number;
  deadlineMs?: number;
  settleMs?: number;
}): Promise<{ callId: string }> {
  const { db, actionId, plan, onCost, fetchImpl = fetch, agentId = process.env.RETELL_CALLER_AGENT_ID, pollMs = 5000, deadlineMs = MAX_CALL_MS + 60_000, settleMs = 30_000 } = input;

  const allowlist = allowlistFromEnv();
  if (allowlist.callNumbers.length !== 1 || allowlist.callNumbers[0] !== LINE_NUMBER) throw new Error(`ALLOWED_CALL_NUMBERS must hold only ${LINE_NUMBER}`);
  const provider = process.env.VOICE_PROVIDER;
  if (provider !== "retell") throw new Error(`VOICE_PROVIDER is "${provider ?? ""}", and only retell is built`);
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error("RETELL_API_KEY is not set");
  if (!agentId) throw new Error("RETELL_CALLER_AGENT_ID is not set, so the Retell caller is not provisioned");
  const agentVersion = process.env.RETELL_CALLER_AGENT_VERSION ?? "";
  if (!/^\d+$/.test(agentVersion)) throw new Error(`RETELL_CALLER_AGENT_VERSION is "${agentVersion}", so the Retell caller is not provisioned`);

  const { planned } = await checkPlan(db, plan);

  const earlier = await db.select({ id: calls.id }).from(calls).where(and(eq(calls.actionId, actionId), eq(calls.mode, "live")));
  if (earlier.length) throw new Error(`Action ${actionId} already had live call ${earlier[0]!.id}, so it will not dial again`);

  const [row] = await db
    .insert(calls)
    .values({ actionId, mode: "live", toNumber: LINE_NUMBER, transcriptJson: [transcriptRow("system", "status", "Live call in progress.")] })
    .returning({ id: calls.id });
  const callId = row!.id;

  const retell = retellClient(apiKey, allowlist, fetchImpl);
  let saved = false;
  try {
    let retellId: string;
    try {
      const placed = (await retell("POST", "/v2/create-phone-call", {
        from_number: CALLER_NUMBER,
        to_number: LINE_NUMBER,
        override_agent_id: agentId,
        // The version provision proved, so a newer draft cannot change what is dialled.
        override_agent_version: Number(agentVersion),
        retell_llm_dynamic_variables: callVariables(plan, planned),
        metadata: { actionId },
      })) as { call_id?: unknown };
      if (typeof placed.call_id !== "string") throw new Error("Retell returned no call id");
      retellId = placed.call_id;
    } catch (error) {
      // Only a 4xx says no call was placed. Anything else may be a call running to the cap with no id to stop, so charge the cap. The row above blocks a second dial.
      if (!(error instanceof RetellHttpError && error.status < 500)) chargeCall(null, "(dial outcome unknown)", onCost);
      throw error;
    }
    // Kept with the row, so the call can be read back by hand even after a crash. The call is running and being paid for, so a failed save must not stop the wait, stop or charge below.
    await appendRow(db, callId, transcriptRow("system", "status", `Live call in progress. Retell call ${retellId}.`)).catch((error) =>
      console.error(`Saving Retell call id ${retellId} failed: ${textOf(error)}`),
    );

    const call = await waitForEnd(retell, retellId, { pollMs, deadlineMs, settleMs });
    chargeCall(call, retellId, onCost);
    if (!call) throw new Error(`Retell call ${retellId} did not end in time`);

    const startMs = call.start_timestamp ?? Date.now();
    // Normalised here, so extractOutcome reads a live call the same way as a sim one.
    const rows = retellToRows(transcriptOf(call), startMs);
    const ended = transcriptRow("system", "status", `Retell call ${retellId} ended: ${call.disconnection_reason ?? call.call_status}.`);
    await db
      .update(calls)
      .set({
        transcriptJson: [...rows, ended],
        // Plain URL: it opens with no login and its expiry is undocumented, and signed ones expire in 24 hours. Fine for AI agents talking about fictional data. Revisit before any non-demo use.
        recordingUrl: call.recording_url ?? null,
        ...(call.start_timestamp ? { startedAt: new Date(call.start_timestamp) } : {}),
        endedAt: call.end_timestamp ? new Date(call.end_timestamp) : new Date(),
      })
      .where(eq(calls.id, callId));
    saved = true;

    const problem = problemWith(call, rows);
    if (problem) throw new Error(`Retell call ${retellId}: ${problem}`);
    return { callId };
  } catch (error) {
    // The partial row stays, marked, so nobody reads it as a call in progress.
    await appendRow(db, callId, transcriptRow("system", "status", `Live call failed: ${textOf(error)}`));
    if (!saved) await closeCall(db, callId);
    throw error;
  }
}
