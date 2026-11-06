status: draft

# Phase 12: Switch to naïve (M10)

HOLD: start only when the human says to switch to naïve (Saturday). Follow section 16 exactly and keep `PLATFORM=local` working as the stage fallback. `naive-recon` re-reads the docs first and may reshape the lanes after it, so treat those as outlines.

**Phase check:** `check-platform.ts` passes with `PLATFORM=naive`, and three full runs succeed.

**Needs from the human:** `NAIVE_API_KEY`, `NAIVE_COMPANY_ID`, `NAIVE_IDENTITY_ID`, `NAIVE_CARD_ID`, DNS access for a custom domain, and a public URL or tunnel for the portal and webhook.

## Notes from earlier research

From a partial docs read on 2026-11-06. Research stopped early by instruction, and several pages could not be opened. All of this is unverified and must be rechecked in `naive-recon`.
- **One approval, many tools:** `ask` is documented per tool call and pauses that tool until `naive session confirm --session $SID --tool-call $CALL_ID`. Bundling is not stated. Six gated tools could mean six confirms, which breaks the single tap. Look at the "awaiting-approval loop" in the session docs for a way to confirm by API once the bundle is approved.
- **SMS:** the phone docs say outbound SMS is "Not available yet" and returns `501 feature_not_configured`, while inbound works. Section 14 has the Approver texting Linda, so this may not work on Saturday. Keep the simulated phone panel as the fallback. US numbers also go through carrier registration, which may take time.
- **Inbound email:** the docs say inbound email wakes the agent that owns the inbox, and that connection webhooks do not wake agents. Sections 12 and 16 assume the opposite (a webhook starts the run). Recheck which is true.
- **Inbound guards:** mail must pass SPF, DKIM and DMARC for the sending domain, and the receiving domain must be verified. There are limits of 5 messages an hour per sender and 20 per inbox. A fake "Pacific Power" sender may be dropped, and repeated rehearsals may hit the limit.
- **Public reachability (inferred, not from the docs):** a hosted naïve browser and webhook probably cannot reach `localhost`, so the portal and webhook likely need a public URL, and the allowlists need updating.
- **Team config seen in docs:** `naive.agents.update(...)` with `multiagent: { type: "coordinator", agents: [...], board: true }`. Delegation is one level deep. Tool policies are set in `tools.configs`.
- **Docs access:** several docs links redirect to `vetta.sh`, which this session's fetch tool was not permitted to open: browser, budgets, audit logs, board and vault. Allow that host before starting `naive-recon`.

## Tasks

### `naive-recon`

**Goal:** Re-read the docs per section 16 step 1, verify every note below, create the company and identity, and store portal credentials and the capped card.

**Estimate:** 1 hour

**Acceptance checks:**
- Notes record the exact package name, auth and API names for every section 5 interface.
- Each note below is marked confirmed or wrong.
- A written answer exists for how one approval releases all gated tools.
- Any primitive that cannot work on Saturday is reported to the human, with its fallback.

**Likely files:**
- `docs/plan/naive-notes.md`

**depends on:** rehearsal

**parallel with:** none

### `naive-public-endpoints`

**Goal:** Make the portal and webhook reachable from naïve, and update the allowlists to our own public origin only.

**Estimate:** 0.5 hours

**Acceptance checks:**
- The naïve browser opens the login page.
- The webhook receives an inbound event.
- The allowlist still rejects every real provider domain.

**Likely files:**
- `docs/plan/naive-endpoints.md`

**depends on:** naive-recon

**parallel with:** naive-io-adapters, naive-runtime-adapter

### `naive-io-adapters`

**Goal:** `packages/platform/src/naive/` adapters for `Mail`, `Sms`, `Browser`, `Vault`, `Card`, `Scheduler` and `Identity`, with the same signatures as local.

**Estimate:** 1.5 hours

**Acceptance checks:**
- Each `.check.ts` passes with `PLATFORM=naive`.
- Vault credentials are referenced by name, never value.
- The card has a hard cap, and one small purchase shows as `card_spend`.
- Nothing outside `packages/platform` changed.

**Likely files:**
- `packages/platform/src/naive/mail.ts`
- `packages/platform/src/naive/sms.ts`
- `packages/platform/src/naive/browser.ts`
- `packages/platform/src/naive/vault.ts`
- `packages/platform/src/naive/card.ts`
- `packages/platform/src/naive/scheduler.ts`
- `packages/platform/src/naive/identity.ts`

**depends on:** naive-recon

**parallel with:** naive-public-endpoints, naive-runtime-adapter

### `naive-runtime-adapter`

**Goal:** `AgentRuntime`, `ApprovalGate`, `Board`, `Audit`, `Budget` and `Llm` on naïve, with gated tools set to `ask`, all others to `allow`, and board and audit mirrored to our tables.

**Estimate:** 2 hours

**Acceptance checks:**
- One approval releases the whole bundle, and the approver shows in the audit log.
- The dashboard works unchanged from the mirrored tables.
- Non-allowlisted targets are still rejected in code first.
- Nothing outside `packages/platform` changed, unless a test proves it necessary.

**Likely files:**
- `packages/platform/src/naive/agent-runtime.ts`
- `packages/platform/src/naive/approval-gate.ts`
- `packages/platform/src/naive/board.ts`
- `packages/platform/src/naive/audit.ts`
- `packages/platform/src/naive/budget.ts`
- `packages/platform/src/naive/llm.ts`

**depends on:** naive-recon

**parallel with:** naive-public-endpoints, naive-io-adapters

### `naive-rehearsal`

**Goal:** Three full runs on naïve from reset, then prove the flip back to local.

**Estimate:** 1 hour

**Acceptance checks:**
- `check-platform.ts` passes with `PLATFORM=naive`.
- Three `demo-reset` and `demo-start` runs in a row succeed.
- Flipping to `PLATFORM=local` still runs the full demo.

**Likely files:**
- `docs/plan/naive-rehearsal-notes.md`

**depends on:** naive-public-endpoints, naive-io-adapters, naive-runtime-adapter

**parallel with:** none
