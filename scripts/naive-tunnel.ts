// pnpm naive:tunnel [-- <command...>]
// Opens a cloudflared quick tunnel to the naïve MCP tool server on NAIVE_MCP_PORT (8790) and nothing else.
// With a command, runs it with NAIVE_MCP_PUBLIC_URL set and closes the tunnel when it ends.
// Without one, writes .env.tunnel and holds the tunnel until Ctrl-C. See docs/plan/naive-endpoints.md.
// Test seams (scripts/naive-tunnel.test.ts): NAIVE_TUNNEL_CLOUDFLARED, NAIVE_TUNNEL_CHECK_URL, NAIVE_TUNNEL_READY_MS.
import { type ChildProcess, spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { rmSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import type { LookupFunction } from "node:net";
import { fileURLToPath } from "node:url";

const ENV_FILE = ".env.tunnel"; // in the working directory; pnpm runs scripts from the repo root
const START_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = Number(process.env.NAIVE_TUNNEL_READY_MS) || 60_000;
const KILL_GRACE_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 * Resolves names on a public resolver, which is what naïve uses.
 * Asking the OS resolver this early caches a miss on macOS for minutes, so it is never asked here.
 */
const resolver = new Resolver({ timeout: 3000 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);
const publicLookup: LookupFunction = (host, options, callback) => {
  resolver.resolve4(host).then(
    (addresses) => (options.all ? callback(null, addresses.map((address) => ({ address, family: 4 }))) : callback(null, addresses[0]!, 4)),
    (error: NodeJS.ErrnoException) => callback(error, "", 4),
  );
};

function answers(url: string): Promise<void> {
  const get = url.startsWith("https:") ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    const request = get(url, { lookup: publicLookup, timeout: 5000 }, (response) => {
      response.resume();
      resolve();
    });
    request.once("timeout", () => request.destroy(new Error("timed out")));
    request.once("error", reject);
  });
}

/** Waits until the public URL resolves and answers HTTP through the edge. Any status counts: the local server may not be up yet. */
async function waitUntilAnswers(url: string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    try {
      return await answers(url);
    } catch (error) {
      last = (error as NodeJS.ErrnoException).code ?? String(error);
    }
    await sleep(1000);
  }
  throw new Error(`${url} did not answer HTTP in ${READY_TIMEOUT_MS / 1000}s (last: ${last})`);
}

/** Signals a process group; false once the group is gone. */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Stops a detached process and everything it started: SIGTERM to its group, SIGKILL if any of it is left after the grace period. */
async function stopTree(proc: ChildProcess | undefined) {
  const pid = proc?.pid;
  if (!pid || !signalGroup(pid, "SIGTERM")) return;
  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    await sleep(100);
    if (!signalGroup(pid, 0)) return;
  }
  signalGroup(pid, "SIGKILL");
}

async function main() {
  const port = Number(process.env.NAIVE_MCP_PORT) || 8790;
  const args = process.argv.slice(2);
  const command = args[0] === "--" ? args.slice(1) : args;

  // Both run in their own process group so shutdown can reach their whole tree. We forward Ctrl-C ourselves.
  const tunnel = spawn(process.env.NAIVE_TUNNEL_CLOUDFLARED ?? "cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let child: ChildProcess | undefined;
  let closing = false;
  const close = async (code: number) => {
    if (closing) return;
    closing = true;
    rmSync(ENV_FILE, { force: true });
    await Promise.all([stopTree(child), stopTree(tunnel)]);
    process.exit(code);
  };
  process.on("SIGINT", () => void close(130));
  process.on("SIGTERM", () => void close(143));

  try {
    const url = await waitForUrl(tunnel);
    tunnel.on("exit", (code) => {
      if (closing) return;
      console.error(`cloudflared exited (${code}); the tunnel is gone.`);
      void close(1);
    });
    await waitUntilAnswers(process.env.NAIVE_TUNNEL_CHECK_URL ?? url);
    if (closing) return;
    writeFileSync(ENV_FILE, `export NAIVE_MCP_PUBLIC_URL=${url}\n`); // export: a sourced file must reach processes launched after it
    console.info(`Tunnel up: ${url} -> http://127.0.0.1:${port}\nNAIVE_MCP_PUBLIC_URL written to .env.tunnel`);

    if (command.length === 0) {
      console.info("Holding the tunnel. Ctrl-C closes it.");
      return;
    }
    // shortcut: a detached command is not in the terminal's foreground group, so it cannot read the terminal; fine for servers.
    child = spawn(command[0]!, command.slice(1), { stdio: "inherit", detached: true, env: { ...process.env, NAIVE_MCP_PUBLIC_URL: url } });
    child.once("error", (error) => {
      console.error(`cannot run ${command[0]}: ${error.message}`);
      void close(1);
    });
    child.once("exit", (code, signal) => void close(code ?? (signal ? 1 : 0)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await close(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
