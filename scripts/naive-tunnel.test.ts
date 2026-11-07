import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tunnelUrl } from "./naive-tunnel.ts";

describe("tunnelUrl", () => {
  it("picks the quick tunnel host from cloudflared's banner", () => {
    const log = [
      "INF Requesting new quick Tunnel on trycloudflare.com...",
      "INF +--------------------------------------------------------------------------------------------+",
      "INF |  https://brave-otter-lamp-pine.trycloudflare.com                                           |",
    ].join("\n");
    expect(tunnelUrl(log)).toBe("https://brave-otter-lamp-pine.trycloudflare.com");
  });

  it("ignores the signup API and logs without a URL", () => {
    expect(tunnelUrl("ERR failed to request quick Tunnel: Post https://api.trycloudflare.com/tunnel")).toBeUndefined();
    expect(tunnelUrl("INF Starting tunnel")).toBeUndefined();
  });
});

// The real script against a fake cloudflared and a local HTTP server standing in for the public URL. No network.
const SCRIPT = fileURLToPath(new URL("./naive-tunnel.ts", import.meta.url));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href; // the runs use a temp cwd, where a bare "tsx" does not resolve
const URL_ = "https://fake-tunnel.trycloudflare.com";
const FAKE = `#!/bin/sh
echo $$ > "$FAKE_PID_FILE"
if [ "$FAKE_MODE" = no-url ]; then echo "ERR boom" >&2; exit 1; fi
echo "INF |  ${URL_}  |" >&2
echo "INF Registered tunnel connection" >&2
if [ "$FAKE_MODE" = die ]; then sleep 1; exit 1; fi
exec sleep 60
`;

let dir: string;
let server: Server;
let checkUrl: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "naive-tunnel-"));
  writeFileSync(join(dir, "cloudflared"), FAKE);
  chmodSync(join(dir, "cloudflared"), 0o755);
  server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  checkUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check: () => boolean, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error("condition not met in time");
};
const pidIn = (file: string) => Number(readFileSync(join(dir, file), "utf8"));

function start(args: string[], env: Record<string, string> = {}) {
  const proc = spawn(process.execPath, ["--import", TSX, SCRIPT, ...args], {
    cwd: dir,
    env: { ...process.env, NAIVE_TUNNEL_CLOUDFLARED: join(dir, "cloudflared"), NAIVE_TUNNEL_CHECK_URL: checkUrl, FAKE_PID_FILE: join(dir, "cf.pid"), FAKE_MODE: "", ...env },
  });
  let output = "";
  proc.stdout.on("data", (c: Buffer) => (output += c));
  proc.stderr.on("data", (c: Buffer) => (output += c));
  const exit = new Promise<number | null>((r) => proc.once("exit", r));
  return { proc, exit, output: () => output };
}
const finished = async (run: { exit: Promise<number | null> }) => {
  const code = await run.exit;
  await until(() => !alive(pidIn("cf.pid")));
  expect(existsSync(join(dir, ".env.tunnel"))).toBe(false);
  return code;
};

describe("naive:tunnel lifecycle", () => {
  it("runs the command with NAIVE_MCP_PUBLIC_URL and passes its exit code on", async () => {
    const run = start(["--", "sh", "-c", `test "$NAIVE_MCP_PUBLIC_URL" = ${URL_} && exit 7`]);
    expect(await finished(run)).toBe(7);
  });

  it("fails before running the command when the URL never answers", async () => {
    const run = start(["--", "touch", "ran"], { NAIVE_TUNNEL_CHECK_URL: "http://127.0.0.1:1", NAIVE_TUNNEL_READY_MS: "1500" });
    expect(await finished(run)).toBe(1);
    expect(run.output()).toContain("did not answer HTTP");
    expect(existsSync(join(dir, "ran"))).toBe(false);
  });

  it("fails when cloudflared exits before giving a URL", async () => {
    const run = start(["--", "touch", "ran"], { FAKE_MODE: "no-url" });
    expect(await finished(run)).toBe(1);
    expect(run.output()).toContain("before giving a URL");
    expect(existsSync(join(dir, "ran"))).toBe(false);
  });

  it("stops the command's whole tree when the tunnel dies mid-run", async () => {
    const run = start(["--", "sh", "-c", "sleep 30 & echo $! > worker.pid; wait"], { FAKE_MODE: "die" });
    expect(await finished(run)).toBe(1);
    await until(() => !alive(pidIn("worker.pid")));
  });

  it("holds without a command, writes .env.tunnel, and cleans up on SIGINT", async () => {
    const run = start([]);
    await until(() => existsSync(join(dir, ".env.tunnel")));
    expect(readFileSync(join(dir, ".env.tunnel"), "utf8")).toBe(`export NAIVE_MCP_PUBLIC_URL=${URL_}\n`);
    // a process launched separately after `source .env.tunnel` must see the URL
    const seen = execFileSync("sh", ["-c", '. ./.env.tunnel && sh -c \'printf %s "$NAIVE_MCP_PUBLIC_URL"\''], { cwd: dir, env: {} });
    expect(seen.toString()).toBe(URL_);
    run.proc.kill("SIGINT");
    expect(await finished(run)).toBe(130);
  });

  it("force-kills a tree that ignores SIGTERM", async () => {
    const run = start(["--", "sh", "-c", `trap "" TERM; sleep 30 & echo $! > stubborn.pid; wait`]);
    await until(() => existsSync(join(dir, "stubborn.pid")));
    run.proc.kill("SIGTERM");
    expect(await finished(run)).toBe(143);
    await until(() => !alive(pidIn("stubborn.pid")));
  });
});
