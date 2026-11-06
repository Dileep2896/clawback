status: approved

# Phase 10: Dashboard (M8)

One projector screen, reading only from Postgres so it works in both platform modes. It needs only the schema and a sample run, so it can start well before the agents finish and fill otherwise idle builder slots.

**Phase check:** A full run is clear on a 1080p projector, judged by a human during `rehearsal`.

**Needs from the human:** Nothing new.

## Tasks

### `dashboard-shell`

**Goal:** Next.js app with the one-screen grid, live updates (SSE or short polling), header (the Bill Fighter name, customer, platform badge, run status, run cost, "Human actions: N", "Demo data" label), dark theme option, a stub file per panel, and a script that inserts a sample run.

**Estimate:** 1 hour

**Acceptance checks:**
- Values change live with no refresh when rows change.
- "Human actions" is counted from approved `approvals` rows, so button plus SMS still counts 1.
- Readable at 1080p with large text, with no page scroll at that size.

**Likely files:**
- `apps/dashboard/app/layout.tsx`
- `apps/dashboard/app/page.tsx`
- `apps/dashboard/app/api/live/`
- `apps/dashboard/lib/`
- `apps/dashboard/package.json`
- `scripts/sample-run.ts`

**depends on:** db-schema

**parallel with:** shared-contracts, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, demo-reset, run-resilience

### `panels-work`

**Goal:** Board panel, and findings with evidence drawers (bill snippet, billed versus real kWh chart, rate comparison table).

**Estimate:** 1 hour

**Acceptance checks:**
- Cards move To do, Doing, Done live.
- Every number in a drawer traces to the `evidence_json` of that finding.
- The Fremont chart shows the jump at the meter swap.
- The drawer works by keyboard.

**Likely files:**
- `apps/dashboard/components/panels/board.tsx`
- `apps/dashboard/components/panels/findings.tsx`
- `apps/dashboard/components/evidence/`

**depends on:** dashboard-shell

**parallel with:** shared-contracts, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, panels-action, panels-money, demo-reset, run-resilience

### `panels-action`

**Goal:** Approval panel with one Approve button, which is the backup approval path in both platform modes, simulated phone panel for local mode with the SMS thread, and call panel with live transcript, timer, highlighted disclosure and browser speech.

**Estimate:** 1 hour

**Acceptance checks:**
- One Approve releases the whole bundle, and a double click records one approval.
- A "YES" in the simulated phone does the same, and the approver is recorded.
- The disclosure line is visibly highlighted and spoken first.
- Approve works with SMS unavailable, proven by a test.
- The call panel shows "sim" or "live", labels a fallback from live, and the transcript still works if browser speech fails.

**Likely files:**
- `apps/dashboard/components/panels/approval.tsx`
- `apps/dashboard/components/panels/phone.tsx`
- `apps/dashboard/components/panels/call.tsx`
- `apps/dashboard/app/api/approve/`
- `apps/dashboard/app/api/sms/`

**depends on:** dashboard-shell

**parallel with:** shared-contracts, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, panels-work, panels-money, demo-reset, run-resilience

### `panels-money`

**Goal:** Ledger panel (refunds, yearly savings, our fee, customer keeps) and the scrolling audit log.

**Estimate:** 1 hour

**Acceptance checks:**
- Ledger totals equal the sum of ledger rows, with no math done in the page beyond that sum.
- The refund is labeled "claimed".
- The audit log shows agent, tool, time and cost, and does not lag with thousands of rows.
- Vault values never show in the log.

**Likely files:**
- `apps/dashboard/components/panels/ledger.tsx`
- `apps/dashboard/components/panels/audit-log.tsx`

**depends on:** dashboard-shell

**parallel with:** shared-contracts, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, panels-work, panels-action, demo-reset, run-resilience
