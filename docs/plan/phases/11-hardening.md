status: approved

# Phase 11: Hardening and rehearsal (M9)

Make the demo repeatable and give it a way to survive failure on stage: reset, replay, retries, three clean runs in a row, and a recorded backup. `rehearsal` is the last lane before the event and the first point where everything runs together.

**Phase check:** Three runs in a row from reset, and replay works offline.

**Needs from the human:** A human to judge the 1080p projector check and to tap approve during rehearsal.

## Tasks

### `demo-reset`

**Goal:** `demo-reset.ts` clears runs, findings, actions, approvals, calls, ledger, board, audit and SMS rows, and keeps seed data.

**Estimate:** 0.5 hours

**Acceptance checks:**
- Seed row counts are identical before and after.
- It refuses to run against any `DATABASE_URL` that is not local, unless explicitly overridden.
- A run started right after reset behaves like the first.

**Likely files:**
- `scripts/demo-reset.ts`

**depends on:** agents-e2e

**parallel with:** voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, dashboard-shell, panels-work, panels-action, panels-money, demo-replay, run-resilience

### `demo-replay`

**Goal:** Capture a successful run and replay it event by event at real speed with `replay.ts`.

**Estimate:** 0.5 hours

**Acceptance checks:**
- Replay works with the network unplugged, needing only local Postgres.
- The dashboard is visibly labeled "replay" during playback.
- Timing matches the recorded run within a few seconds.

**Likely files:**
- `scripts/replay.ts`
- `data/replay/`

**depends on:** agents-e2e, panels-work, panels-action, panels-money

**parallel with:** voice-sim, call-provider-tool, voice-live-spike, voice-live-line, voice-live-caller, finance-ledger, finance-invoice, monitor-check, demo-reset, run-resilience

### `run-resilience`

**Goal:** Retries and clear errors for the failures most likely on stage: model timeouts, portal timeouts, Stripe errors, live call failures, budget overrun.

**Estimate:** 0.5 hours

**Acceptance checks:**
- A forced failure in each of those five retries or stops with a clear message on the dashboard, and these tests spend no live call credits.
- A retry never repeats a gated action or asks for a second approval.
- Going over budget stops the run cleanly, without silently losing rows.

**Likely files:**
- `packages/agents/src/retry.ts`

**depends on:** agents-e2e, voice-live-caller, finance-invoice, monitor-check

**parallel with:** dashboard-shell, panels-work, panels-action, panels-money, demo-reset, demo-replay

### `rehearsal`

**Goal:** Run the section 19 script end to end, fix what breaks, and record the backup video.

**Estimate:** 1 hour

**Acceptance checks:**
- Three full runs in a row from `demo-reset` on `VOICE_MODE=sim`, each ending on "Human actions: 1".
- Each of those runs ends with exactly one CEO summary email to the owner in Mailpit, and its numbers match the ledger.
- One full run with a real call passes, and live calls so far total about 5 full tests or fewer, leaving enough credit on both accounts for the stage run.
- Each run's time and cost is written down against the 2 to 4 minute limit, and cost stays inside `RUN_BUDGET_USD`.
- A human confirms the screen is clear on a 1080p projector.
- A backup video of a full run exists outside the repo.
- A search finds no real provider contact, no live Stripe key and no committed `.env`.

**Likely files:**
- `docs/plan/rehearsal-notes.md`

**depends on:** demo-reset, demo-replay, run-resilience

**parallel with:** none
