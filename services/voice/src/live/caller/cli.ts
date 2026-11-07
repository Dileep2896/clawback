// pnpm exec tsx --env-file=.env services/voice/src/live/caller/cli.ts provision | readback <retell call id> | readback-line <retell start ms>
// None of these places a call. Each one talks to a paid account, so run it only with the word for that exact step.
import { allowlistFromEnv } from "@bill-fighter/shared/allowlist";
import { z } from "zod";
import { CallMessage, checkLineCall, keypadDigits } from "../line/check.ts";
import { vapiClient } from "../line/vapi.ts";
import { CALLER_NUMBER } from "./agent.ts";
import { provisionCaller } from "./provision.ts";
import { retellClient } from "./retell.ts";

const retellKey = process.env.RETELL_API_KEY;
if (!retellKey) throw new Error("RETELL_API_KEY is not set");
const retell = retellClient(retellKey, allowlistFromEnv());
const [command, arg] = process.argv.slice(2);
const MAX_START_GAP_MS = 60_000;

// The list only finds the call: on the first real call its `messages` was a string, not the array GET /call/{id} gives.
const VapiListedCall = z.looseObject({
  id: z.string(),
  startedAt: z.string().optional(),
  customer: z.looseObject({ number: z.string().optional() }).optional(),
});
const VapiCall = z.looseObject({ status: z.string().optional(), cost: z.number().optional(), messages: z.unknown() });

// The line's own record: the independent check of the disclosure, and the proof the call reached the rep.
async function checkLine(retellStartMs: number) {
  const vapiKey = process.env.VAPI_API_KEY;
  if (!vapiKey) throw new Error("VAPI_API_KEY is not set");
  const vapi = vapiClient(vapiKey);
  const [latest] = z.array(VapiListedCall).parse(await vapi("GET", "/call?limit=1"));
  if (!latest) throw new Error("Vapi has no calls");
  if (latest.customer?.number !== CALLER_NUMBER) throw new Error(`The latest Vapi call ${latest.id} is from ${latest.customer?.number}, not our caller`);
  // Written this way round so a missing time on either side (NaN) also fails.
  if (!(Math.abs(Date.parse(latest.startedAt ?? "") - retellStartMs) <= MAX_START_GAP_MS)) {
    throw new Error(`The latest Vapi call ${latest.id} started at ${latest.startedAt}, not within 60 seconds of the Retell call at ${retellStartMs}`);
  }
  const call = VapiCall.parse(await vapi("GET", `/call/${latest.id}`));
  // Before the messages are read, so a surprise there cannot lose the cost.
  console.log(`\nVapi call ${latest.id}. Status: ${call.status}, cost: $${call.cost}`);
  const messages = z.array(CallMessage).parse(call.messages);
  const problems = checkLineCall(messages);
  console.log(`Keypad digits: ${keypadDigits(messages).join(",") || "none"}`);
  console.log(problems.length ? `Problems:\n${problems.join("\n")}` : "The line matches the design.");
  if (problems.length) process.exitCode = 1;
}

if (command === "provision") {
  const { agentId, agentVersion, llmId } = await provisionCaller(retell);
  console.log(`Caller is as designed. Agent ${agentId} version ${agentVersion}, LLM ${llmId}. Set these in .env:\nRETELL_CALLER_AGENT_ID=${agentId}\nRETELL_CALLER_AGENT_VERSION=${agentVersion}`);
} else if (command === "readback" && arg) {
  const call = (await retell("GET", `/v2/get-call/${arg}`)) as Record<string, unknown>;
  console.log(
    JSON.stringify(
      { status: call.call_status, reason: call.disconnection_reason, start: call.start_timestamp, end: call.end_timestamp, recording: call.recording_url, cost: call.call_cost },
      null,
      2,
    ),
  );
  console.log(String(call.transcript));
  await checkLine(Number(call.start_timestamp));
} else if (command === "readback-line" && arg) {
  // Vapi's half alone, for when Retell's half has already been read.
  await checkLine(Number(arg));
} else {
  throw new Error("Usage: cli.ts provision | readback <retell call id> | readback-line <retell start ms>");
}
