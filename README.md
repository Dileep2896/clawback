# Clawback

**Built November 7, 2026 at the naïve x YC Autonomous Company Hackathon.**

Small businesses overpay on their utility and phone bills, and nobody checks. Clawback is a team of AI agents that reads every bill, finds the overcharges, calls or emails the provider, files the claim and records the money. The owner approves once.

**Try it:** https://clawback-sandbox-2e3cr9qffcxs.vercel.app (hosted as a naïve App). Tap "Try it now" to watch a recorded audit play out on your own sandbox account.

## How it works

| Agent | What it does |
|---|---|
| CEO | Hands each step to an agent and checks it is done |
| Intake | Reads the bill email and identifies the customer |
| Collector | Logs in to the provider portal and downloads bills and meter usage |
| Auditor | Checks every line against the tariff and the meter (for example a doubled meter multiplier) |
| Filer | Drafts the refund claim, rate change requests and cancellation letters |
| Approver | Asks the owner once for the whole bundle |
| Negotiator | Calls the provider (Retell and Vapi) or emails it, with an AI disclosure |
| Finance | Records the savings in a ledger and invoices our 30% fee |
| Monitor | Schedules the next bill check |

In the sample run: a $12,606.06 refund claimed and $18,319.32 a year in savings for a three-store restaurant group.

The agents also run on naïve: see `/naive` on the site and `docs/plan/naive-notes.md`.

## Honest notes

- Demo data only. The utility and phone providers are local replicas (`*.example` domains); the agents never contact a real company. Calls go only to allowlisted numbers. Stripe runs in test mode.
- Claimed is not granted: the ledger shows refunds as claimed until the provider grants them, and the fee applies only to money that actually comes back.
- The public sandbox replays a recorded run; it never runs agents, places calls or sends email.

## Run it locally

Needs Node 22, pnpm and Docker.

```sh
pnpm install
docker compose up -d          # Postgres on 5433, Mailpit on 8025
cp .env.example .env          # fill in your own keys; never commit .env
pnpm db:migrate && pnpm seed && pnpm seed:portal
pnpm dev:dashboard            # http://localhost:3000
pnpm dev:portal               # provider replicas on 3001
pnpm dev:webhooks             # webhooks on 3002
pnpm demo:start               # one audit run (VOICE_MODE=sim by default)
pnpm demo:replay              # replay the recorded run, no model or voice cost
```

`pnpm test`, `pnpm lint` and `pnpm typecheck` run the checks.

## Layout

- `apps/dashboard`: landing page, public pages and the customer app (Next.js)
- `apps/portal`: provider portal replicas
- `services/webhooks`: webhooks, tool server and the local agent runtime
- `packages/agents`, `packages/core`, `packages/db`, `packages/platform`, `packages/shared`: agents, audit rules and money math, database, local and naïve platform adapters
- `docs/plan`: plans, research and rehearsal notes
