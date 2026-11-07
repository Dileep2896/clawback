// The local webhook service does what Next.js cannot: vault, mail and the parser (services/webhooks/src/dashboard.ts).
const BASE = process.env.WEBHOOK_URL || "http://127.0.0.1:3002";

export const WEBHOOK_DOWN = "The Clawback agents service is not running. Start it with `pnpm dev:webhooks`, then try again.";

export type WebhookReply = { ok: boolean; status: number; body: Record<string, unknown> };

export async function callWebhook(path: string, payload: unknown, timeoutMs = 15_000): Promise<WebhookReply> {
  let response: Response;
  try {
    response = await fetch(new URL(path, BASE), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") return { ok: false, status: 504, body: { error: "timeout" } };
    return { ok: false, status: 503, body: { error: WEBHOOK_DOWN } };
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}
