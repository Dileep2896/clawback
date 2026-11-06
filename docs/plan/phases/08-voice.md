status: draft

# Phase 08: Voice (M6)

Build the real call and its fallback. By the human's decision, `VOICE_MODE=live` is a must-have for the demo and is off the section 17 cut list. Sim stays as the automatic fallback, labeled on screen. The human is solo, so the provider rep is always the second AI agent with a fixed script, and no task needs a teammate or `PROVIDER_REP_FORWARD_NUMBER`. To use free credits, this replaces the section 11 Twilio IVR: a Retell outbound agent on one purchased number calls a free inbound Vapi number, where one assistant speaks the BayTel menu and then plays the rep. There is no Twilio in the demo, because its trial blocks handing a caller to an AI rep. Credits are small and each live call spends on both accounts (roughly 30 to 90 minutes on Retell and 35 to 50 on Vapi). Rehearse with `VOICE_MODE=sim`, and spend live calls only on the spike, about 5 full tests, and the stage run.

**Phase check:** After approval a real Retell call to our Vapi line runs with no human on it, the transcript shows the disclosure first, the outcome is saved, and a forced live failure falls back to sim with an on-screen label.

**Needs from the human:** A Retell account with KYC done and a card on file (the number costs $2 a month), and a Vapi account.

## Tasks

### `voice-sim`

**Goal:** Simulated call engine: simulated IVR ("For billing, press 2"), the Negotiator lines, and a provider side played by a second Claude agent with a fixed script. Transcript rows are stored as they happen. This is the automatic fallback for live calls.

**Estimate:** 2 hours

**Acceptance checks:**
- The first transcript line is the exact disclosure constant, inserted by code and not by the model, proven by a test.
- A full call covers menu, account number, seven lines, three promos, confirm back, ticket number repeated, polite end.
- The whole call completes against the scripted rep with no human input.
- Alarm lines are refused by code if the model asks to cancel them.

**Likely files:**
- `services/voice/src/sim/`
- `services/voice/src/transcript.ts`

**depends on:** db-schema, shared-contracts, platform-agent-runtime

**parallel with:** platform-db-adapters, platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-live-spike, voice-live-line, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `call-provider-tool`

**Goal:** The gated `call_provider` and `cancel_service` tools for the Negotiator, plus outcome extraction into `calls.outcome_json` as `{ cancelled_lines, credits, ticket }`. `cancel_service` records cancellations from the call outcome.

**Estimate:** 1 hour

**Acceptance checks:**
- Blocked without an approved bundle, and released without a second tap with one.
- A non-allowlisted number is rejected before any call starts.
- The outcome lists only what the transcript supports: a refused item stays out, and its finding stays unwon.
- `cancel_service` only records lines the outcome confirms, and never an alarm line.
- `VOICE_MODE` picks the call engine, and a failed live call can hand over to sim, labeled on screen.

**Likely files:**
- `packages/agents/src/tools/negotiator.ts`
- `services/voice/src/outcome.ts`

**depends on:** voice-sim, agent-roster, platform-db-adapters

**parallel with:** platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-live-spike, voice-live-line, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `voice-live-spike`

**Goal:** Read the Retell outbound call docs and Vapi inbound docs, then place one real call to test the three unverified points in the design. If the spike fails, tell the orchestrator. Do not switch providers on your own.

**Estimate:** 0.5 hours

**Acceptance checks:**
- `docs/plan/voice-design.md` records the result of each point, with sources and the cost of the call.
- Point 1: a Retell number can dial the Vapi free number.
- Point 2: the Vapi assistant reacts to Press Digit tones. If it cannot, the design has it speak the menu and advance once the caller has acted, and the transcript stays honest about what happened.
- Point 3: transcript and recording retrieval from Retell gives what the `calls` table needs.

**Likely files:**
- `docs/plan/voice-design.md`

**depends on:** shared-contracts

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `voice-live-line`

**Goal:** Our mock provider line: the free Vapi number with one assistant that speaks the BayTel menu and then plays the rep on the fixed script.

**Estimate:** 1 hour

**Acceptance checks:**
- A real call to the Vapi number hears the menu and reaches the rep with no human on the line.
- The assistant behavior matches the spike result, and the transcript never claims a tone was recognized if it was not.
- No call is ever forwarded to a personal phone.
- Testing uses as few live calls as possible, and each one's cost is logged.

**Likely files:**
- `services/voice/src/live/line/`

**depends on:** voice-live-spike

**parallel with:** db-schema, platform-interfaces, platform-db-adapters, platform-io-adapters, platform-agent-runtime, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, agent-roster, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, voice-sim, call-provider-tool, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `voice-live-caller`

**Goal:** The Retell outbound agent behind `call_provider` with `VOICE_PROVIDER=retell`: disclosure first, Press Digit for the menu, account number, cancel seven lines, restore three promos, confirm each item, get and repeat a ticket number. Live transcript, recording URL and outcome are saved.

**Estimate:** 1.5 hours

**Acceptance checks:**
- A real call reaches our Vapi line and completes with no human on it.
- The disclosure is first, word for word, in recording and transcript.
- `ALLOWED_CALL_NUMBERS` holds only the Vapi number, and a test proves any other number never dials.
- A ticket number is saved in `calls.outcome_json` with `calls.mode=live`.
- The cost of each live call is logged, and calls are kept short.
- A forced failure falls back to sim automatically, with the on-screen label.

**Likely files:**
- `services/voice/src/live/caller/`

**depends on:** voice-live-line, call-provider-tool

**parallel with:** platform-io-adapters, tariff-data, tariff-calculator, load-profile, seed-generator, bill-pdfs, seed-loader, bill-parser, rules-billing, rules-rates-lines, audit-local-cli, portal-shell, portal-downloads, tools-collect-audit, tools-file-approve, run-trigger, agents-e2e, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay
