status: approved

# Phase 01: Foundation (M0)

Lay down the monorepo, local services, database schema and shared contracts. This phase also owns every file many lanes would otherwise fight over: root `package.json` scripts, the lockfile, `.env.example`, `.gitignore` and the Drizzle schema. Later lanes import these and do not edit them, which is what lets three builders run side by side.

**Phase check:** `pnpm test` and `pnpm db:migrate` succeed, and the Mailpit web inbox opens.

**Needs from the human:** Docker, Node 20+ and pnpm on the build machine. No API keys.

## Tasks

### `repo-skeleton`

**Goal:** pnpm workspace with every app, service and package from section 4 at the repo root (no nested `bill-fighter/` folder), `docker-compose.yml` for Postgres and Mailpit, test runner, lint, and a boundary lint rule that blocks platform SDK imports outside `packages/platform`.

**Estimate:** 0.5 hours

**Acceptance checks:**
- `pnpm install && pnpm test && pnpm lint` pass on a clean clone.
- `docker compose up` starts Postgres and Mailpit, and the Mailpit inbox opens at `MAILPIT_API`.
- Root `package.json` already declares every script later lanes need (`db:migrate`, `seed`, `audit:local`, `check-platform`, `demo:start`, `demo:reset`, `demo:replay`, `run:local`).
- All dependencies named in section 3 are declared up front, so later lanes rarely touch the lockfile.
- Packages expose subpath exports (`"./*": "./src/*.ts"`) instead of barrel files, so no lane has to edit a shared `index.ts`.
- `.env.example` matches section 18 minus `PROVIDER_REP_FORWARD_NUMBER`, which the demo does not use, with `VOICE_PROVIDER=retell` and the Twilio vars marked optional. `.gitignore` covers `.env`, `data/bills/` and `data/seed/`, and `data/parsed/` stays committed.
- A test proves an import of the Agent SDK, Playwright or nodemailer outside `packages/platform` fails lint. `scripts/` seed and e2e code is exempt for Playwright (see the decisions in `docs/plan/schedule.md`).
- `docs/fleet/PLAYBOOK.md` TODOs are filled in with the real commands and conventions.

**Likely files:**
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `docker-compose.yml`
- `.env.example`
- `.gitignore`
- `docs/fleet/PLAYBOOK.md`
- `eslint.config.mjs`
- `tsconfig.base.json`

**depends on:** none

**parallel with:** none

### `db-schema`

**Goal:** Drizzle schema and first migration for every table in section 6, including `approvals`, `board_cards`, `sms_messages`, `calls.mode`, `runs.platform`, `runs.cost_usd`, ledger `card_spend`, and one added `provider` value for a fictional third party gas supplier.

**Estimate:** 0.5 hours

**Acceptance checks:**
- `pnpm db:migrate` works on an empty database and is safe to re-run.
- A test inserts and reads one row per table.
- All money columns are integer cents, except the `cost_usd` columns section 6 names.

**Likely files:**
- `packages/db/src/schema.ts`
- `packages/db/migrations/`
- `packages/db/src/client.ts`

**depends on:** repo-skeleton

**parallel with:** shared-contracts, platform-interfaces, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, agent-roster, voice-live-spike, voice-live-line

### `shared-contracts`

**Goal:** Zod schemas and types every lane builds against: `Tariff`, `ParsedBill`, `Finding`, seed fixture shapes, the exact disclosure line, the gated tool list, and allowlist checks for phone numbers, email domains and portal origins.

**Estimate:** 0.5 hours

**Acceptance checks:**
- The disclosure constant matches section 2 word for word, enforced by a test.
- Tests prove the allowlist rejects PG&E, AT&T and Comcast domains and numbers not on the list, and fails closed when the list is empty.
- The gated list is exactly `call_provider`, `submit_claim`, `change_rate_plan`, `cancel_service`, `create_invoice`, `card_pay`.

**Likely files:**
- `packages/shared/src/`

**depends on:** repo-skeleton

**parallel with:** db-schema, dashboard-shell, panels-work, panels-action, panels-money
