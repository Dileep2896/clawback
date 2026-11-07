// Sends the bill email, then delivers it to the webhook, which starts the run. Takes no input.
// pnpm dev:webhooks must be running first. pnpm demo:start
import { getPlatform } from "@bill-fighter/platform/factory";
import { billEmail } from "@bill-fighter/webhooks/bill-email";
import { INBOUND_PATH, WEBHOOK_PORT } from "@bill-fighter/webhooks/server";

const platform = getPlatform();
const { email: companyEmail } = await (await platform.identity()).get();
const email = billEmail(companyEmail);
const { id } = await (await platform.mail()).send(email);
console.info(`Sent "${email.subject}" to ${email.to}`);

let response: Response;
try {
  response = await fetch(`http://127.0.0.1:${WEBHOOK_PORT}${INBOUND_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: id, ...email }),
  });
} catch (cause) {
  console.error("The inbound webhook is not reachable. Start it with `pnpm dev:webhooks`, then run this again.", cause);
  process.exit(1);
}

const body = await response.text();
if (response.status !== 202) {
  console.error(`The webhook refused the email: ${response.status} ${body}`);
  process.exit(1);
}
console.info(`Run started: ${(JSON.parse(body) as { runId: string }).runId}`);
