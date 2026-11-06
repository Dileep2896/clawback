status: draft

# Phase 02: Platform layer, local (M1)

Define the section 5 interfaces and build all the local adapters, so business logic never imports a platform SDK. `platform-agent-runtime` is the riskiest lane in the local build: it must prove early that subagents, in-process tools and a `canUseTool` gate work together, before anything is built on them.

**Phase check:** `scripts/check-platform.ts` calls each interface once and every local check passes.

**Needs from the human:** `ANTHROPIC_API_KEY` for `platform-agent-runtime`. `VAULT_KEY` is generated locally and needs no account.

## Tasks

### `platform-interfaces`

**Goal:** All section 5 interfaces, plus one addition: `Llm.structured(input, jsonSchema)` so the parser can call Claude without importing the SDK. The `getPlatform()` factory, and a `check-platform.ts` runner that discovers `*.check.ts` files, so adapter lanes never edit a shared check list.

**Estimate:** 0.5 hours

**Acceptance checks:**
- `getPlatform()` loads adapters one file per interface and throws a clear error for an unknown `PLATFORM`.
- The runner prints pass or fail per discovered check and exits non-zero on any failure.
- `PLATFORM=naive` fails with a "not built yet" message rather than a crash.

**Likely files:**
- `packages/platform/src/types.ts`
- `packages/platform/src/factory.ts`
- `scripts/check-platform.ts`

**depends on:** shared-contracts

**parallel with:** db-schema, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, dashboard-shell, panels-work, panels-action, panels-money

### `platform-db-adapters`

**Goal:** Local `Board`, `Audit`, `ApprovalGate`, `Budget` and `Card` backed by Postgres.

**Estimate:** 0.5 hours

**Acceptance checks:**
- `ApprovalGate` creates one `approvals` row for a bundle, and a test proves an action outside an approved bundle stays blocked while one inside it is released.
- `Card` refuses a charge over the cap and writes `card_spend` to the ledger.
- `Budget` reports the running total and signals when over `RUN_BUDGET_USD`.
- Each adapter ships a `.check.ts` that passes.

**Likely files:**
- `packages/platform/src/local/board.ts`
- `packages/platform/src/local/audit.ts`
- `packages/platform/src/local/approval-gate.ts`
- `packages/platform/src/local/budget.ts`
- `packages/platform/src/local/card.ts`

**depends on:** db-schema, platform-interfaces

**parallel with:** platform-io-adapters, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, run-trigger, voice-sim, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `platform-io-adapters`

**Goal:** Local `Mail` (Mailpit), `Sms` (simulated, `sms_messages` table), `Vault` (encrypted JSON file), `Identity`, `Scheduler` (node-cron) and `Browser` (Playwright). Read the Mailpit docs first.

**Estimate:** 1 hour

**Acceptance checks:**
- `Mail` sends a message that appears in Mailpit, and refuses a recipient outside `ALLOWED_EMAIL_DOMAINS`.
- `Browser` refuses any origin outside `ALLOWED_PORTAL_ORIGINS`.
- The vault file holds no plaintext secret, and the wrong key fails loudly instead of returning empty.
- Each adapter ships a `.check.ts` that passes.

**Likely files:**
- `packages/platform/src/local/mail.ts`
- `packages/platform/src/local/sms.ts`
- `packages/platform/src/local/vault.ts`
- `packages/platform/src/local/identity.ts`
- `packages/platform/src/local/scheduler.ts`
- `packages/platform/src/local/browser.ts`

**depends on:** db-schema, platform-interfaces

**parallel with:** platform-db-adapters, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, dashboard-shell, panels-work, panels-action, panels-money

### `platform-agent-runtime`

**Goal:** Local `AgentRuntime` and `Llm` on the Claude Agent SDK: `query()`, programmatic subagents, in-process tools via `createSdkMcpServer()`, and approvals through `canUseTool`. Read the current SDK docs first (section 15).

**Estimate:** 1.5 hours

**Acceptance checks:**
- A spike with one main agent, one subagent and one gated tool runs for real: the gated tool pauses until the gate releases it, including when a subagent makes the call.
- Gated tools are never in `allowedTools`, enforced by a test.
- A denied call returns control to the agent and does not crash the run.
- Run cost is read from SDK result messages and passed to `Budget`.
- `Llm.structured` returns schema-valid JSON or throws.

**Likely files:**
- `packages/platform/src/local/agent-runtime.ts`
- `packages/platform/src/local/llm.ts`

**depends on:** platform-interfaces

**parallel with:** db-schema, platform-db-adapters, platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, dashboard-shell, panels-work, panels-action, panels-money
