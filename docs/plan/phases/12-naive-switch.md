status: approved

# Phase 12: Switch to naïve (M10)

HOLD: start only when the human says to switch to naïve (Saturday). Follow section 16 exactly and keep `PLATFORM=local` working as the stage fallback. `naive-recon` re-reads the docs first and may reshape the lanes after it, so treat those as outlines. Voice stays on our own stack. Saturday approval, by the human's decision: the Approver emails Linda the request and she replies YES by text to the naïve number (inbound SMS). The dashboard tap stays built as the backup and is used if the inbound SMS wake test fails.

**Phase check:** `check-platform.ts` passes with `PLATFORM=naive`, reporting `Sms` send honestly as not available, and three full runs succeed.

**Needs from the human:** `NAIVE_API_KEY`, `NAIVE_COMPANY_ID`, `NAIVE_IDENTITY_ID`, `NAIVE_CARD_ID`, DNS access for a custom domain, and a public URL or tunnel for the portal and webhook.

## Notes from earlier research

From partial docs reads on 2026-11-06. Research stopped early by instruction, and several pages could not be opened. Recheck all of this in `naive-recon`.
- **One approval, many tools:** `ask` is documented per tool call and pauses that tool until `naive session confirm --session $SID --tool-call $CALL_ID`. Bundling is not stated. Six gated tools could mean six confirms, which breaks the single tap. Look at the "awaiting-approval loop" in the session docs for a way to confirm by API once the bundle is approved.
- **Outbound SMS:** treat as not available. Sends are refused with `501 feature_not_configured`, so the Approver emails Linda the request instead of texting it. `check-platform.ts` must report this honestly, not as a pass.
- **Inbound SMS:** works once a number is bought, but the phone page says it wakes the agent while the identity page says it does not yet. Test this directly. US numbers also go through carrier registration, which may take time.
- **Voice:** the phone and identity docs mention no voice calling, so voice stays on our own stack.
- **Inbound email:** the docs say inbound email wakes the agent that owns the inbox, and that connection webhooks do not wake agents. Sections 12 and 16 assume the opposite (a webhook starts the run). Recheck which is true.
- **Inbound guards:** mail must pass SPF, DKIM and DMARC for the sending domain, and the receiving domain must be verified. There are limits of 5 messages an hour per sender and 20 per inbox. A fake "BayCurrent Electric" sender may be dropped, and repeated rehearsals may hit the limit.
- **Public reachability (inferred, not from the docs):** a hosted naïve browser and webhook probably cannot reach `localhost`, so the portal and webhook likely need a public URL, and the allowlists need updating.
- **Team config seen in docs:** `naive.agents.update(...)` with `multiagent: { type: "coordinator", agents: [...], board: true }`. Delegation is one level deep. Tool policies are set in `tools.configs`.
- **Docs access:** `vetta.sh` is naïve's old name, and its docs are fine to read at M10. The browser, budgets, audit logs, board and vault pages redirect there and have not been read yet. The fetch tool was denied that host on Nov 6, so it may need allowing.

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
- Each `.check.ts` passes with `PLATFORM=naive`, except `Sms` send, which reports not available and never fakes a pass.
- Whether inbound SMS wakes an agent is tested and written down. If it does not, the human is told that the dashboard tap is the Saturday approval path.
- The approval email reaches Linda through `Mail`.
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
- A YES by text from the owner number releases the bundle, a YES from any other number does not, and the dashboard tap still works.
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
- `check-platform.ts` passes with `PLATFORM=naive`, with `Sms` send reported as not available.
- Three `demo-reset` and `demo-start` runs in a row succeed on `VOICE_MODE=sim` to save call credits, approved by emailed request and a YES text, or by the dashboard tap if the inbound SMS wake test failed.
- Flipping to `PLATFORM=local` still runs the full demo.

**Likely files:**
- `docs/plan/naive-rehearsal-notes.md`

**depends on:** naive-public-endpoints, naive-io-adapters, naive-runtime-adapter

**parallel with:** none
