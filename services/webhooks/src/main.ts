// pnpm dev:webhooks
import { loadTools } from "@bill-fighter/agents/registry";
import { stopRunsOnSignal } from "@bill-fighter/agents/run";
import { db } from "@bill-fighter/db/client";
import { getPlatform } from "@bill-fighter/platform/factory";
import { startScheduledRun } from "./scheduled.ts";
import { createInboundServer, INBOUND_PATH, WEBHOOK_PORT } from "./server.ts";

stopRunsOnSignal(db);

const platform = getPlatform();
const deps = {
  db,
  mail: await platform.mail(),
  runtime: await platform.agentRuntime(),
  audit: await platform.audit(),
  tools: await loadTools(),
  // For the dashboard's connect, upload and "Start my audit" (dashboard.ts).
  identity: await platform.identity(),
  vault: await platform.vault(),
  llm: await platform.llm(),
};
const scheduler = await platform.scheduler();
scheduler.onFire((check) => startScheduledRun(check, deps));
const server = createInboundServer({ ...deps, scheduler });

// Localhost only: these endpoints have no auth, and every accepted email or fired check starts a model run.
server.listen(WEBHOOK_PORT, "127.0.0.1", () => {
  console.info(`Inbound webhook on http://127.0.0.1:${WEBHOOK_PORT}${INBOUND_PATH}`);
});
