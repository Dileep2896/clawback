import { createServer, type IncomingMessage } from "node:http";
import type { Scheduler } from "@bill-fighter/platform/types";
import { connectPortal, type DashboardDeps, parseUpload, startBillRun } from "./dashboard.ts";
import { handleInbound, type InboundDeps, type InboundReply } from "./inbound.ts";
import { handleFireCheck } from "./scheduled.ts";

// WEBHOOK_PORT lets a second worktree run its own service beside the main one; the dashboard then needs WEBHOOK_URL to match.
export const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT) || 3002;
export const INBOUND_PATH = "/inbound";
export const FIRE_CHECK_PATH = "/fire-check";
export const START_AUDIT_PATH = "/start-audit";
export const CONNECT_PORTAL_PATH = "/connect-portal";
export const PARSE_UPLOAD_PATH = "/parse-upload";
export const MAX_BODY_BYTES = 1024 * 1024;
// An uploaded bill arrives as base64 inside JSON.
export const MAX_UPLOAD_BODY_BYTES = 8 * 1024 * 1024;

// The dashboard's deps are optional, so tests and agents-e2e that only need /inbound keep working.
type ServerDeps = InboundDeps & { scheduler: Pick<Scheduler, "fire"> } & Partial<Omit<DashboardDeps, keyof InboundDeps>> & { mail: Partial<DashboardDeps["mail"]> };

const dashboard = (handle: (payload: unknown, deps: DashboardDeps) => Promise<InboundReply>) => (payload: unknown, deps: ServerDeps) =>
  deps.identity && deps.vault && deps.mail.send ? handle(payload, deps as DashboardDeps) : Promise.resolve({ status: 503, body: { error: "This server was started without the dashboard's services" } });

const ROUTES: Record<string, (payload: unknown, deps: ServerDeps) => Promise<InboundReply>> = {
  [INBOUND_PATH]: handleInbound,
  [FIRE_CHECK_PATH]: handleFireCheck,
  [START_AUDIT_PATH]: dashboard((_payload, deps) => startBillRun(deps)),
  [CONNECT_PORTAL_PATH]: dashboard(connectPortal),
  [PARSE_UPLOAD_PATH]: dashboard(parseUpload),
};

async function replyTo(request: IncomingMessage, deps: ServerDeps): Promise<InboundReply> {
  const route = request.method === "POST" && request.url ? ROUTES[request.url] : undefined;
  if (!route) return { status: 404, body: { error: "Not found" } };
  const limit = request.url === PARSE_UPLOAD_PATH ? MAX_UPLOAD_BODY_BYTES : MAX_BODY_BYTES;

  // Keeps reading past the limit without storing it, so the client gets the 413 rather than a reset connection.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) return { status: 413, body: { error: "Body too large" } };

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return { status: 400, body: { error: "Body is not JSON" } };
  }
  return route(payload, deps);
}

export function createInboundServer(deps: ServerDeps) {
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
