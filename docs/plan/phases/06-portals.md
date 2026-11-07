status: approved

# Phase 06: Replica portals (M4)

Build clearly fictional provider portals for the Collector to work through. Section 9 names two brands, but every bill must be downloadable, so one app serves BayConnect as a third brand from config, not extra pages, and the fictional gas supplier as one more config entry. BayConnect goes with "second portal" in the cut order.

**Phase check:** A Playwright script logs in and downloads every bill.

**Needs from the human:** Nothing new.

## Tasks

### `portal-shell`

**Goal:** Next.js portal on port 3001 with brand config (BayCurrent Business, BayTel Business, BayConnect, the fictional gas supplier), demo banner, login, account list with location picker and pagination, and one session-expiry modal.

**Estimate:** 1 hour

**Acceptance checks:**
- Every page shows "Demo portal, not a real utility".
- Wrong credentials are refused, and each login only sees its own provider accounts.
- The modal appears once per session and can be dismissed by a script.
- No real company design, logo or text, and no CAPTCHA.
- Credentials reach the Collector through the `Vault` interface, not through plaintext in the repo.

**Likely files:**
- `apps/portal/app/layout.tsx`
- `apps/portal/app/login/`
- `apps/portal/app/accounts/`
- `apps/portal/lib/`
- `apps/portal/package.json`
- `scripts/seed-portal-credentials.ts`

**depends on:** seed-loader

**parallel with:** platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `portal-downloads`

**Goal:** Bills page with PDF download, 15 minute usage CSV, and a BayTel line inventory with call counts (the `unusedLines` rule needs this data and section 9 does not list it). Plus the Playwright download-all script.

**Estimate:** 1 hour

**Acceptance checks:**
- The script logs into each brand and downloads all 448 PDFs, and sha256 matches `data/bills/`.
- The usage CSV matches `usage_intervals` for a sampled account.
- A download without a session returns 401, and a path outside the bills folder is refused.

**Likely files:**
- `apps/portal/app/bills/`
- `apps/portal/app/usage/`
- `apps/portal/app/lines/`
- `apps/portal/e2e/`

**depends on:** portal-shell

**parallel with:** platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, agent-roster, tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money
