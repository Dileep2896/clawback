import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isGatedTool } from "@bill-fighter/shared/gated-tools";
import { z } from "zod";
import type { AgentDef, ApprovalGate, ToolDef } from "../types.ts";

export type ToolServerDeps = {
  runId: string;
  agents: AgentDef[];
  tools: ToolDef[];
  /** The bearer naïve injects from our vault. */
  token: string;
  gate: Pick<ApprovalGate, "isReleased">;
  onDenied: (agent: string, tool: string, reason: string) => void;
  ended: () => boolean;
  /** Tracks a handler so the run waits for it before it ends. */
  running: <T>(work: () => Promise<T>) => Promise<T>;
};

export const toolPath = (agent: string) => `/mcp/${encodeURIComponent(agent)}`;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const textResult = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) });

function bearerMatches(header: string | undefined, token: string) {
  const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** One MCP server per agent path, offering only that agent's own tools, so the caller is known and held to its list. */
function serverFor(def: AgentDef, deps: ToolServerDeps) {
  const server = new McpServer({ name: "clawback", version: "1.0.0" });
  for (const tool of deps.tools.filter((t) => def.tools.includes(t.name))) {
    if (!(tool.inputSchema instanceof z.ZodObject)) throw new Error(`Tool ${tool.name}: inputSchema must be a z.object`);
    // The whole z.object goes to MCP, which validates with it (refinements and strictness included) before the handler.
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, (input: unknown) =>
      deps.running(async () => {
        try {
          // naïve's ask is released from our approvals row, and this repeats the check on the validated input, so a
          // gated call that reached us any other way still does nothing.
          if (isGatedTool(tool.name)) {
            const { actionId } = input as { actionId?: unknown };
            if (typeof actionId !== "string" || !actionId || !(await deps.gate.isReleased(actionId))) {
              const reason = `${tool.name} ran without an approved actionId`;
              deps.onDenied(def.name, tool.name, reason);
              return textResult(reason, true);
            }
          }
          if (deps.ended()) return textResult(`${tool.name} did not run, because this run has ended`, true);
          const output = await tool.handler(input, { runId: deps.runId, agent: def.name });
          return textResult(JSON.stringify(output) ?? "null");
        } catch (error) {
          return textResult(errorText(error), true);
        }
      }),
    );
  }
  return server;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

export async function startToolServer(deps: ToolServerDeps, port: number): Promise<{ port: number; close: () => Promise<void> }> {
  const byPath = new Map(deps.agents.map((def) => [toolPath(def.name), def]));
  const fail = (res: ServerResponse, status: number, message: string) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
  };

  const http = createServer(async (req, res) => {
    try {
      if (!bearerMatches(req.headers.authorization, deps.token)) return fail(res, 401, "unauthorized");
      const def = byPath.get(new URL(req.url ?? "/", "http://x").pathname);
      if (!def) return fail(res, 404, "no such agent");
      // Stateless: a fresh server and transport per request, closed with the response.
      const server = serverFor(def, deps);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.method === "POST" ? await readJson(req) : undefined);
    } catch (error) {
      if (!res.headersSent) fail(res, 500, errorText(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, resolve);
  });
  return {
    port: (http.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
