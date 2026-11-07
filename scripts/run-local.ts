// The whole flow in this terminal with auto approval, for fast testing. Never used on stage.
// pnpm run:local
import { randomUUID } from "node:crypto";
import { loadTools } from "@bill-fighter/agents/registry";
import { executeRun, runPrompt, stopRunsOnSignal } from "@bill-fighter/agents/run";
import { db } from "@bill-fighter/db/client";
import { runs } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { getPlatform, platformName } from "@bill-fighter/platform/factory";
import type { RunEvent } from "@bill-fighter/platform/types";
import { billEmail } from "@bill-fighter/webhooks/bill-email";
import { autoApprove } from "./auto-approve.ts";

function print(event: RunEvent) {
  if (event.type === "text") console.info(`[${event.agent}] ${event.text}`);
  else if (event.type === "tool_call") console.info(`[${event.agent}] calls ${event.tool}`);
  else if (event.type === "denied") console.info(`[${event.agent}] denied ${event.tool}: ${event.reason}`);
}

async function main() {
  if (platformName() !== "local") throw new Error("run-local auto approves, so it only runs on PLATFORM=local");
  stopRunsOnSignal(db);

  const platform = getPlatform();
  const { email: companyEmail } = await (await platform.identity()).get();
  const email = { messageId: `run-local-${randomUUID()}`, ...billEmail(companyEmail) };

  const [run] = await db
    .insert(runs)
    .values({ customerId: CUSTOMER.id, platform: platformName(), trigger: "manual", status: "running" })
    .returning({ id: runs.id });
  console.info(`Run ${run!.id}`);

  const stop = autoApprove(await platform.approvalGate(), run!.id);
  const status = await executeRun({
    db,
    runId: run!.id,
    prompt: runPrompt(email),
    runtime: await platform.agentRuntime(),
    audit: await platform.audit(),
    tools: await loadTools(),
    onEvent: print,
  });
  stop();
  console.info(`Run ${run!.id} finished: ${status}`);
  return status === "success" ? 0 : 1;
}

// process.exit, not a natural end: an open browser session's proxy keeps the process alive for 10 idle minutes.
try {
  process.exit(await main());
} catch (error) {
  console.error(error);
  console.error("If the customer is missing, run `pnpm seed` first.");
  process.exit(1);
}
