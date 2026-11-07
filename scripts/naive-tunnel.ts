// pnpm naive:tunnel [-- <command...>]
// Opens a cloudflared quick tunnel to the naïve MCP tool server on NAIVE_MCP_PORT (8790) and nothing else.
// With a command, runs it with NAIVE_MCP_PUBLIC_URL set and closes the tunnel when it ends.
// Without one, writes .env.tunnel and holds the tunnel until Ctrl-C. See docs/plan/naive-endpoints.md.
import { type ChildProcess, spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_FILE = fileURLToPath(new URL("../.env.tunnel", import.meta.url));
const START_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 60_000;

/** The quick tunnel's public URL from cloudflared's log, or undefined. api.trycloudflare.com is the signup API, not ours. */
export function tunnelUrl(log: string): string | undefined {
  return log.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/)?.[0];
}

function waitForUrl(tunnel: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`cloudflared gave no URL in ${START_TIMEOUT_MS / 1000}s:\n${log}`)), START_TIMEOUT_MS);
    const read = (chunk: Buffer) => {
      log += chunk.toString();
      const url = tunnelUrl(log);
      // The URL is printed before the edge has a connection; wait for one so the run never gets a dead URL.
      if (url && log.includes("Registered tunnel connection")) {
        clearTimeout(timer);
        resolve(url);
      }
    };
    tunnel.stdout?.on("data", read);
    tunnel.stderr?.on("data", read);
    tunnel.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`cannot start cloudflared (brew install cloudflared): ${error.message}`));
    });
    tunnel.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (${code}) before giving a URL:\n${log}`));
    });
  });
}

/**
 * Waits until the tunnel's name resolves on a public resolver, which is what naïve uses.
 * Asking the OS resolver this early caches a miss on macOS for minutes, so it is never asked here.
 */
async function waitUntilResolvable(url: string) {
  const resolver = new Resolver({ timeout: 3000 });
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const host = new URL(url).hostname;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    try {
      if ((await resolver.resolve4(host)).length > 0) return;
    } catch (error) {
      last = (error as NodeJS.ErrnoException).code ?? String(error);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${host} did not resolve in ${READY_TIMEOUT_MS / 1000}s (last: ${last})`);
}

async function main() {
  const port = Number(process.env.NAIVE_MCP_PORT) || 8790;
  const args = process.argv.slice(2);
  const command = args[0] === "--" ? args.slice(1) : args;

  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  let child: ChildProcess | undefined;
  let closing = false;
  const close = (code: number) => {
    if (closing) return;
    closing = true;
    rmSync(ENV_FILE, { force: true });
    tunnel.kill();
    child?.kill();
    process.exit(code);
  };
  process.on("SIGINT", () => close(130));
  process.on("SIGTERM", () => close(143));

  try {
    const url = await waitForUrl(tunnel);
    tunnel.on("exit", (code) => {
      console.error(`cloudflared exited (${code}); the tunnel is gone.`);
      close(1);
    });
    await waitUntilResolvable(url);
    writeFileSync(ENV_FILE, `NAIVE_MCP_PUBLIC_URL=${url}\n`);
    console.info(`Tunnel up: ${url} -> http://127.0.0.1:${port}\nNAIVE_MCP_PUBLIC_URL written to .env.tunnel`);

    if (command.length === 0) {
      console.info("Holding the tunnel. Ctrl-C closes it.");
      return;
    }
    child = spawn(command[0]!, command.slice(1), { stdio: "inherit", env: { ...process.env, NAIVE_MCP_PUBLIC_URL: url } });
    child.once("error", (error) => {
      console.error(`cannot run ${command[0]}: ${error.message}`);
      close(1);
    });
    child.once("exit", (code, signal) => close(code ?? (signal ? 1 : 0)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    close(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
