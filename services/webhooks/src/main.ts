// pnpm dev:webhooks
import { loadTools } from "@bill-fighter/agents/registry";
import { db } from "@bill-fighter/db/client";
import { getPlatform } from "@bill-fighter/platform/factory";
import { createInboundServer, INBOUND_PATH, WEBHOOK_PORT } from "./server.ts";

const platform = getPlatform();
const server = createInboundServer({
  db,
  mail: await platform.mail(),
  runtime: await platform.agentRuntime(),
  audit: await platform.audit(),
  tools: await loadTools(),
});

// Localhost only: this endpoint has no auth and every accepted email starts a model run.
server.listen(WEBHOOK_PORT, "127.0.0.1", () => {
  console.info(`Inbound webhook on http://127.0.0.1:${WEBHOOK_PORT}${INBOUND_PATH}`);
});
