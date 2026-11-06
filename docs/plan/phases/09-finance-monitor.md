status: approved

# Phase 09: Finance and monitor (M7)

Record what the run achieved, invoice our share in Stripe test mode, and schedule next month. Fee math lives in `packages/core`. By the human's decision, the refund shows as "claimed" and we invoice now, with a line saying the refund part is due only when it is granted.

**Phase check:** The ledger shows refunds, savings, fee and customer keeps, and a Stripe test invoice exists.

**Needs from the human:** `STRIPE_SECRET_KEY` (test mode) for `finance-invoice`.

## Tasks

### `finance-ledger`

**Goal:** Fee math in core (30% of refund plus first year savings) and the `record_savings` tool.

**Estimate:** 0.5 hours

**Acceptance checks:**
- A test computes the fee to the cent, using `savings_share_pct`.
- The refund is recorded as claimed, not won.
- Items the rep refused on the call are not counted as won.
- Running the tool twice for one finding does not double count.

**Likely files:**
- `packages/core/src/money/`
- `packages/agents/src/tools/finance-ledger.ts`

**depends on:** agent-roster, platform-db-adapters

**parallel with:** platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `finance-invoice`

**Goal:** Gated `create_invoice` on Stripe test mode, and gated `card_pay` through the `Card` interface. Read the Stripe docs first.

**Estimate:** 0.5 hours

**Acceptance checks:**
- Startup refuses any key that does not begin with `sk_test_`, proven by a test.
- The invoice amount equals the core fee to the cent, and appears in the Stripe test dashboard.
- The invoice has a line saying the refund part is due only when the refund is granted.
- A retry does not create a second invoice, using an idempotency key.
- Both tools are blocked without an approved bundle.

**Likely files:**
- `packages/agents/src/tools/finance-invoice.ts`

**depends on:** finance-ledger

**parallel with:** platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `monitor-check`

**Goal:** `schedule_check` through `Scheduler`, for next month's bill check.

**Estimate:** 0.5 hours

**Acceptance checks:**
- A scheduled check is visible in the dashboard data and in `audit_log`.
- A forced firing starts a run with `trigger=schedule`.
- Finishing a run twice leaves one scheduled check.

**Likely files:**
- `packages/agents/src/tools/monitor.ts`

**depends on:** agent-roster, platform-io-adapters

**parallel with:** platform-db-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay
