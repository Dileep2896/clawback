status: draft

# Phase 08: Voice (M6)

Build the simulated call fully, and expose it as the single gated `call_provider` tool. Live voice is optional, comes last, and is the first thing to drop.

**Phase check:** After approval the call runs, the transcript shows the disclosure first, and the outcome is saved.

**Needs from the human:** Nothing for sim. `voice-live` needs Twilio, a Retell or Vapi key, and a teammate phone number.

## Tasks

### `voice-sim`

**Goal:** Simulated call engine: simulated IVR ("For billing, press 2"), the Negotiator lines, and a provider side played by a teammate through an input endpoint or by a second Claude call with a fixed script. Transcript rows are stored as they happen.

**Estimate:** 2 hours

**Acceptance checks:**
- The first transcript line is the exact disclosure constant, inserted by code and not by the model, proven by a test.
- A full call covers menu, account number, seven lines, three promos, confirm back, ticket number repeated, polite end.
- Works with both the teammate and the scripted rep.
- Alarm lines are refused by code if the model asks to cancel them.

**Likely files:**
- `services/voice/src/sim/`
- `services/voice/src/transcript.ts`

**depends on:** db-schema, shared-contracts, platform-agent-runtime

**parallel with:** platform-db-adapters, platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `call-provider-tool`

**Goal:** The gated `call_provider` tool for the Negotiator, plus outcome extraction into `calls.outcome_json` as `{ cancelled_lines, credits, ticket }`.

**Estimate:** 1 hour

**Acceptance checks:**
- Blocked without an approved bundle, and released without a second tap with one.
- A non-allowlisted number is rejected before any call starts.
- The outcome lists only what the transcript supports: a refused item stays out, and its finding stays unwon.
- Section 11 live-to-sim fallback has a clear hook, labeled on screen.

**Likely files:**
- `packages/agents/src/tools/negotiator.ts`
- `services/voice/src/outcome.ts`

**depends on:** voice-sim, agent-roster, platform-db-adapters

**parallel with:** platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `voice-live` (optional)

**Goal:** OPTIONAL, run only if the human asks. Twilio mock IVR, plus a Retell or Vapi outbound agent. Read both docs and choose the simpler outbound API. A failed live call falls back to sim and is labeled.

**Estimate:** 1.5 hours

**Acceptance checks:**
- A real call reaches the teammate phone from an allowlisted number, and a non-allowlisted number never dials.
- The disclosure is first, word for word, in recording and transcript.
- A forced failure falls back to sim with the on-screen label.

**Likely files:**
- `services/voice/src/live/`

**depends on:** call-provider-tool

**parallel with:** platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay, run-resilience, rehearsal
