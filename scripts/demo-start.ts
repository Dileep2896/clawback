// Starts the demo run exactly as the dashboard's "Start my audit" does: the webhook service sends the bill email and delivers it
// (startBillRun in services/webhooks/src/dashboard.ts). Takes no input. pnpm dev:webhooks must be running first. pnpm demo:start
import { START_AUDIT_PATH, WEBHOOK_PORT } from "@bill-fighter/webhooks/server";

let response: Response;
try {
  response = await fetch(`http://127.0.0.1:${WEBHOOK_PORT}${START_AUDIT_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
} catch (cause) {
  console.error("The inbound webhook is not reachable. Start it with `pnpm dev:webhooks`, then run this again.", cause);
  process.exit(1);
}

const body = await response.text();
if (response.status !== 202) {
  console.error(`The webhook refused the email: ${response.status} ${body}`);
  process.exit(1);
}
console.info(`Sent the bill email. Run started: ${(JSON.parse(body) as { runId: string }).runId}`);
