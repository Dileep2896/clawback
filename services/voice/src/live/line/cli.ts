// pnpm exec tsx --env-file=.env services/voice/src/live/line/cli.ts provision | rehearse | readback <call id>
// None of these place a call. `rehearse` spends a little Vapi credit, so use it sparingly.
import { z } from "zod";
import { CallMessage, checkLineCall, keypadDigits } from "./check.ts";
import { findLineAssistant, provision } from "./provision.ts";
import { rehearse } from "./rehearse.ts";
import { vapiClient } from "./vapi.ts";

const apiKey = process.env.VAPI_API_KEY;
if (!apiKey) throw new Error("VAPI_API_KEY is not set");
const vapi = vapiClient(apiKey);
const [command, arg] = process.argv.slice(2);

if (command === "provision") {
  console.log("Line is as designed:", await provision(vapi));
} else if (command === "rehearse") {
  const assistant = await findLineAssistant(vapi);
  if (!assistant) throw new Error("Run provision first");
  const { results, costUsd, stoppedBecause } = await rehearse(vapi, String(assistant.id));
  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"} caller: ${r.caller}\n     reply: ${r.reply}${r.ok ? "" : `\n     wanted: ${r.expected}`}`);
  }
  console.log(`Run cost: $${costUsd.toFixed(5)}${stoppedBecause ? `. STOPPED: ${stoppedBecause}` : ""}`);
  if (stoppedBecause || results.some((r) => !r.ok)) process.exitCode = 1;
} else if (command === "readback" && arg) {
  const call = z
    .looseObject({ status: z.string().optional(), cost: z.number().optional(), messages: z.array(CallMessage).default([]) })
    .parse(await vapi("GET", `/call/${arg}`));
  const problems = checkLineCall(call.messages);
  console.log(`Status: ${call.status}, cost: $${call.cost}, keypad digits: ${keypadDigits(call.messages).join(",") || "none"}`);
  console.log(problems.length ? `Problems:\n${problems.join("\n")}` : "Matches the design.");
  if (problems.length) process.exitCode = 1;
} else {
  throw new Error("Usage: cli.ts provision | rehearse | readback <call id>");
}
