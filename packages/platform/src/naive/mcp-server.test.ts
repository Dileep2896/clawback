import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Approval, ToolDef } from "../types.ts";
import { startToolServer, toolPath } from "./mcp-server.ts";

const ran: string[] = [];
const tool = (name: string): ToolDef => ({
  name,
  description: name,
  inputSchema: z.object({ actionId: z.string().optional() }) as unknown as ToolDef["inputSchema"],
  handler: async (_input, ctx) => {
    ran.push(`${ctx.agent}:${name}`);
    return { ok: true };
  },
});

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  ran.length = 0;
});

async function serve(released: string[]) {
  const denied: string[] = [];
  const server = await startToolServer(
    {
      runId: "run-1",
      agents: [
        { name: "filer", description: "", prompt: "", tools: ["submit_claim", "draft_letter"], maxTurns: 1 },
        { name: "intake", description: "", prompt: "", tools: ["get_customer"], maxTurns: 1 },
      ],
      tools: [tool("submit_claim"), tool("draft_letter"), tool("get_customer")],
      token: "secret-token",
      // Another run's approval of a-other must not release it here.
      gate: { get: async (runId) => (runId === "run-1" ? ({ status: "approved", actionIds: released } as Approval) : null) },
      onDenied: (agent, name) => denied.push(`${agent}:${name}`),
      ended: () => false,
      running: (work) => work(),
    },
    0,
  );
  close = server.close;
  const url = (agent: string) => new URL(`http://127.0.0.1:${server.port}${toolPath(agent)}`);
  const connect = async (agent: string, token = "secret-token") => {
    const client = new Client({ name: "test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(url(agent), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    return client;
  };
  return { url, connect, denied };
}

describe("naïve tool server", () => {
  it("offers each agent only its own tools and runs them as that agent", async () => {
    const { connect } = await serve([]);
    const filer = await connect("filer");
    expect((await filer.listTools()).tools.map((t) => t.name).sort()).toEqual(["draft_letter", "submit_claim"]);
    await filer.callTool({ name: "draft_letter", arguments: {} });
    expect(ran).toEqual(["filer:draft_letter"]);
    await expect(filer.callTool({ name: "get_customer", arguments: {} })).resolves.toMatchObject({ isError: true });
  });

  it("refuses a gated call that is not released, and runs it once released", async () => {
    const { connect, denied } = await serve(["a-ok"]);
    const filer = await connect("filer");
    expect(await filer.callTool({ name: "submit_claim", arguments: { actionId: "a-no" } })).toMatchObject({ isError: true });
    expect(denied).toEqual(["filer:submit_claim"]);
    expect(await filer.callTool({ name: "submit_claim", arguments: { actionId: "a-ok" } })).not.toHaveProperty("isError");
    expect(ran).toEqual(["filer:submit_claim"]);
  });

  it("rejects a wrong bearer and an unknown agent path", async () => {
    const { url } = await serve([]);
    const post = (agent: string, token: string) =>
      fetch(url(agent), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
    expect((await post("filer", "wrong")).status).toBe(401);
    expect((await post("nobody", "secret-token")).status).toBe(404);
  });
});
