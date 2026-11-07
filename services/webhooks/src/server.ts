import { createServer, type IncomingMessage } from "node:http";
import { handleInbound, type InboundDeps, type InboundReply } from "./inbound.ts";

export const WEBHOOK_PORT = 3002;
export const INBOUND_PATH = "/inbound";
export const MAX_BODY_BYTES = 1024 * 1024;

async function replyTo(request: IncomingMessage, deps: InboundDeps): Promise<InboundReply> {
  if (request.method !== "POST" || request.url !== INBOUND_PATH) return { status: 404, body: { error: "Not found" } };

  // Keeps reading past the limit without storing it, so the client gets the 413 rather than a reset connection.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) return { status: 413, body: { error: "Body too large" } };

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return { status: 400, body: { error: "Body is not JSON" } };
  }
  return handleInbound(payload, deps);
}

export function createInboundServer(deps: InboundDeps) {
  return createServer((request, response) => {
    replyTo(request, deps)
      .catch((error: unknown): InboundReply => {
        console.error("Inbound webhook failed:", error);
        return { status: 500, body: { error: "Could not start the run" } };
      })
      .then(({ status, body }) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      });
  });
}
