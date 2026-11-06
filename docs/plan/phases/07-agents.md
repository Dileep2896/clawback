status: draft

# Phase 07: Agents on the Claude Agent SDK (M5)

Wire the CEO and member agents to tools and the approval gate, so one email starts a run that stops at exactly one pending approval. Tools take whole batches, so the Collector and Auditor do not spend hundreds of model turns on one bill each.

**Phase check:** `demo-start` runs everything with no human input and stops at one pending approval.

**Needs from the human:** `ANTHROPIC_API_KEY`.

## Tasks

### `agent-roster`

**Goal:** Prompts for all nine agents in `packages/agents/prompts/`, roster with narrow tool lists and turn limits, and a tool registry that scans `src/tools/`, so adding a tool file never edits a shared list.

**Estimate:** 1 hour

**Acceptance checks:**
- A test proves each agent only gets the tools in section 10.
- Prompts tell agents never to compute money and to call core tools instead.
- Every tool call passes through a wrapper that writes `audit_log` and rejects non-allowlisted targets before the platform sees them.

**Likely files:**
- `packages/agents/prompts/`
- `packages/agents/src/roster.ts`
- `packages/agents/src/registry.ts`
- `packages/agents/src/tool-wrapper.ts`

**depends on:** platform-agent-runtime

**parallel with:** db-schema, platform-db-adapters, platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, voice-sim, dashboard-shell, panels-work, panels-action, panels-money

### `tools-collect-audit`

**Goal:** Intake, Collector and Auditor tools: `parse_inbound_email`, `get_customer`, `portal_login`, `download_bills`, `download_usage`, `store_bill`, `store_usage`, `parse_bill`, `run_audit`, `price_usage`.

**Estimate:** 1.5 hours

**Acceptance checks:**
- The Collector gets its password by vault name, and the value never appears in `audit_log` or agent context.
- `download_bills` and `parse_bill` accept batches, and a full customer run takes a handful of tool calls.
- Findings written to the database carry bill and line ids, and each amount equals the core output exactly.

**Likely files:**
- `packages/agents/src/tools/intake.ts`
- `packages/agents/src/tools/collector.ts`
- `packages/agents/src/tools/auditor.ts`

**depends on:** agent-roster, platform-db-adapters, platform-io-adapters, bill-parser, audit-local-cli, portal-downloads

**parallel with:** tools-file-approve, run-trigger, voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `tools-file-approve`

**Goal:** Filer and Approver tools: `draft_letter`, `attach_evidence`, `submit_claim`, `change_rate_plan`, `cancel_service`, `request_approval`, `send_sms`. Letters are PDFs where Claude writes the wording and every number is filled in from the finding.

**Estimate:** 1.5 hours

**Acceptance checks:**
- Rule 17.1 claim, Rule 12 request and cancellation letters render as PDFs with evidence attached.
- A test proves letter numbers equal finding numbers, and that alarm lines never appear in a cancellation.
- `request_approval` creates exactly one `approvals` row listing all action ids, and calling it again in the same run reuses that row.
- `submit_claim`, `change_rate_plan` and `cancel_service` are gated, and only change status on our own tables.

**Likely files:**
- `packages/agents/src/tools/filer.ts`
- `packages/agents/src/tools/approver.ts`
- `packages/agents/src/letters/`

**depends on:** agent-roster, platform-db-adapters, platform-io-adapters

**parallel with:** tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, run-trigger, voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `run-trigger`

**Goal:** `services/webhooks/inbound` starts a run, `demo-start.ts` sends the bill email, and `run-local.ts` runs the terminal flow with auto approval.

**Estimate:** 1 hour

**Acceptance checks:**
- `demo-start` creates a run with `trigger=email` and `platform` set, with no prompt typed.
- The same email delivered twice starts one run.
- The webhook rejects a payload that fails validation.
- `run-local` auto approval cannot be enabled by the webhook or on the demo path.

**Likely files:**
- `services/webhooks/`
- `scripts/demo-start.ts`
- `scripts/run-local.ts`

**depends on:** agent-roster, platform-io-adapters

**parallel with:** platform-db-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, tools-file-approve, voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money

### `agents-e2e`

**Goal:** Run the whole chain for real and fix prompts until it reliably stops at one approval. Measure time and cost.

**Estimate:** 1 hour

**Acceptance checks:**
- Two runs in a row reach one pending approval with no human input.
- No gated tool ran, and every tool call is in `audit_log`, with board cards moving per agent.
- Time to approval and cost per run are reported, against the 2 minute mark in the demo script and `RUN_BUDGET_USD=5`.

**Likely files:**
- `packages/agents/test/e2e.test.ts`
- `packages/agents/prompts/`

**depends on:** tools-collect-audit, tools-file-approve, run-trigger

**parallel with:** voice-sim, call-provider-tool, voice-live, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money
