# naïve public endpoints (M10)

Lane `naive-public-endpoints`, 2026-11-07. Reshaped by the human: a tunnel script, not a public portal.

## What is public, and only while a run is going

| Local service | Port | Public? |
|---|---|---|
| naïve MCP tool server (`naive-runtime-adapter`, paths `/mcp/<agent>`, bearer from the `clawback-mcp` vault) | `NAIVE_MCP_PORT`, default 8790 | **Yes**, through `pnpm naive:tunnel`, only while a naïve run or test is going |
| Inbound webhook service (`pnpm dev:webhooks`) | 3002, bound to 127.0.0.1 | No |
| Dashboard, portal | local | No. The Collector keeps Playwright and the local vault (see `naive-notes.md`, Blocker 3) |

**Session-event webhook.** `naive-runtime-adapter` polls sessions and events, so there is no naïve webhook receiver today. If one is added, make it a path on the 8790 tool server (for example `/naive-events`, with its own check of naïve's signature), so this one tunnel covers it. Do not open a second tunnel for it.

**Allowlists are unchanged.** The allowlists in code (`packages/agents/src/tool-wrapper.ts`, `packages/platform/src/local/mail.ts`, `packages/platform/src/local/browser.ts`) limit where we *send*: mail, browser and tool targets. The tunnel adds only an inbound origin, so they still reject every real provider domain.

## How to use it

On stage, in naïve mode (the webhook service starts runs, so its runtime gets the URL):

```sh
PLATFORM=naive pnpm naive:tunnel -- pnpm dev:webhooks
```

- **With a command after `--`**: the script opens the tunnel, then runs the command with `NAIVE_MCP_PUBLIC_URL` in its environment. When the command exits, the tunnel closes and the command's exit code is passed on. Ctrl-C closes both.
- **Without a command** (`pnpm naive:tunnel`): it holds the tunnel until Ctrl-C and writes `export NAIVE_MCP_PUBLIC_URL=<url>` to `.env.tunnel` (gitignored by `.env.*`). In another shell, `source .env.tunnel` exports the URL, so every process started from that shell afterwards gets it (for example `source .env.tunnel && PLATFORM=naive pnpm dev:webhooks`). The file is deleted when the tunnel closes. The existing scripts do not read it.

What the script does (`scripts/naive-tunnel.ts`):
1. Starts `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<NAIVE_MCP_PORT>` (a free quick tunnel with no Cloudflare account; it needs `brew install cloudflared`).
2. Takes the `https://<name>.trycloudflare.com` URL from cloudflared's log, and waits until cloudflared reports a registered edge connection (30 s limit).
3. Waits until the public URL answers HTTP through the edge (any status counts; 60 s limit), resolving the name on public DNS (1.1.1.1, then 8.8.8.8). It does **not** ask the OS resolver: on macOS a lookup made before the record exists caches the miss for minutes, which broke the first test. The command starts only after this.
4. If cloudflared dies mid-run, the script stops the command and exits 1, because the run cannot work without the tunnel.
5. Shutdown (command exit, tunnel loss, Ctrl-C, SIGTERM) stops cloudflared and the command's **whole process tree**: both run in their own process group, which gets SIGTERM, then SIGKILL if anything is left after 5 s. The script waits for that before it exits. Because the command is in its own group it cannot read from the terminal; fine for servers like `dev:webhooks`. If the script itself is SIGKILLed, nothing cleans up (known limit).

The URL changes every time the script starts. The runtime reads it at run start, so restart the run's process (the command after `--`) with a fresh tunnel. Never paste a URL from an old tunnel.

## Tested (2026-11-07, free, no naïve calls)

Against a local echo server on 8790:
- `pnpm naive:tunnel -- sh -c '... curl "$NAIVE_MCP_PUBLIC_URL/mcp/test"; exit 7'` printed `echo GET /mcp/test` through the public URL. The script exited 7, cloudflared was gone and `.env.tunnel` was removed. Ready in about 7 s.
- Hold mode: `.env.tunnel` was written, `curl $NAIVE_MCP_PUBLIC_URL/hold` answered, and SIGINT exited 130 with cloudflared stopped and the file removed.
- Again after the fix round: the HTTP readiness check passed through the real edge, the command got a 502 from the edge (nothing on the port), its exit 3 was passed on, cloudflared stopped and `.env.tunnel` was removed.
- `scripts/naive-tunnel.test.ts` runs the real script against a fake cloudflared and a local HTTP server (no network): reading the URL from the log, the command's env and exit code, readiness timeout (command never runs), cloudflared dying before a URL, the tunnel dying mid-run (the command's background worker is killed too), hold mode writing an exported `.env.tunnel` (a separately launched process sees the URL after sourcing it) and cleaning up on SIGINT, and a tree that ignores SIGTERM being force-killed.

**Not tested here:** a naïve agent calling the tool server through the tunnel. That is `naive-runtime-adapter`'s probe and `naive-rehearsal`.
