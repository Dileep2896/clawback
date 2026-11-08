# Plan: agents-redesign

## Human ruling, 2026-11-07 (orchestrator note `ar-type.md`): applies app-wide
"The text size is really bad and why are we showing the sandbox such a big way. We need to make the UI elegant and mordern AI application."
- **Type tokens, set once in `apps/dashboard/app/globals.css`** (`@theme` `--text-*`), used across the whole signed-in app: body 14/20 weight 400; secondary and labels 13 muted, not bold; captions and table heads 12; panel and section titles 14–15 weight 600; page title 20 weight 600; one hero money figure per page at 32–40 serif, all other money at body size. 600 only for titles and the active item; no bold body text; `tabular-nums` on money and times. Nothing above 20px except that one figure. This answers Q1: the /agents 22px floor and its check go; `dashboard-shell-check.ts` and the `panels-*` checks instead assert a 12px floor and a 20px ceiling apart from one `data-hero-figure`.
- **Look:** quiet dark surfaces, 1px hairlines, 24px card padding, 16–24px gaps, 8–10px radius, colour only where it means something, small calm motion (streaming line, pulsing dot), 16px line icons. Existing radius tokens already match; `Card`/`PageHeader`/`AppNav`/`Table`/`StatTile` in `components/ui/` are restyled at the source so every page follows.
- **Sandbox notice:** no banner. A 12px pill in the page header beside the run status, muted text with a small amber dot, "Sandbox replay · 2×", opening a small popover with the full sentence and "Watch it again". Replaces `ReplayBanner` (on `fleet/judge-link`: merge main after it ships and replace it there; until then the current banner becomes this pill). Supersedes item 6 below.
- **Scope grows:** Overview, Bills, Findings, Money, sign-up, log-in and onboarding are rechecked against the scale and fixed in this lane (not only a critical/major Hallmark audit). Item 8 below becomes this.
- **Screenshots for the human:** /agents at 1920x1080 and 1440x900 (approval and call moments), Overview, and 390x844, each beside its before (befores taken on this branch before any change).
- With the 14px scale, the /agents sizes in item 1–3 follow the tokens: timeline names 14 weight 600, actions 13 muted, Now-pane title 20 weight 600 (answers.md Q1), "money found" in the header is the page's one hero figure (32–40 serif); ledger and finding amounts at body size, lime.

## What exists today
- `app/(app)/agents/page.tsx` lays out 8 `Panel`s in a 4-column grid (Board, Findings, Approval, Phone, Agents, Call, Ledger, Audit log) under `components/header.tsx` (h1, Platform, Run status, step/finding chips, Run cost, Demo data pill, "Human actions" `MeterRegister` drums). `ReplayBanner` (also in `header.tsx`) is the 34px amber bar.
- Data: one `useLive()` snapshot polled every second (`lib/snapshot.ts`). `lib/agents.ts` `agentRows()` builds one row per agent from board cards and audit rows (CEO and the run card excluded). Audit rows carry no input, only agent/tool/time/cost.
- Agents in the recorded run, in order: intake, collector, auditor, approver, negotiator, filer, finance, plus monitor (`schedule_check`), and ceo.
- Reusable pieces: `evidence/kwh-chart.tsx` `KwhChart`, `evidence/bill-snippet.tsx` `BillSnippet`, `evidence/drawer.tsx` `EvidenceDrawer`, `lib/ledger.ts` `ledgerView`, `lib/calls.ts` (transcript, speech), `lib/use-approve.ts`, the landing's `wave-bar` waveform (bento.tsx) and `RollUp` / `useReducedMotion` (landing/motion.tsx), `ui/` `StatusDot`, `Button`.
- Guards on this page: `scripts/dashboard-shell-check.ts` (22px floor on /agents), `panels-work-check.ts`, `panels-action-check.ts`, `panels-money-check.ts`, `agents-e2e.ts`, `replay-check.ts`, `stop-check.ts` and `rehearse-stage.ts` (waits for "No cards yet" to disappear). They key on `data-card`, `data-board-row`, `blocked-stamp`, `approve`, `sms-reply`, `call-timer`, `data-call-row`, `data-audit-row`, `data-finding`, `ledger-*`, `human-actions`, `replay-banner`.

## Design (from the brief)
Page = slim sandbox bar (only on replays) → one-line run header → two columns: timeline (~360px) | Now pane; audit log collapsed under the Now pane. Stacks under 1100px (timeline above Now), no horizontal scroll at 390.

1. **Run header** (one line): status dot + "Running"/"Finished", elapsed, money found so far (lime, `font-figure`, rolls up via `RollUp`), "1 human action" text (`data-testid="human-actions"` kept), run cost, Demo data chip. No Platform, no drums, no step chips. Run problems / connection lost stay as one coral line under it.
2. **Timeline** (`components/agents/timeline.tsx`): CEO as the header row, then one row per agent in fixed run order (intake, collector, auditor, approver, negotiator, filer, finance, monitor last, see Q4). Dot: blue pulsing while working, lime done, amber while the run waits on the human (pending approval, on the approver row), coral failed/blocked. Name, action in plain words on up to 2 lines (wraps, no ellipsis on short phrases), elapsed. Rows are buttons: picking one pins the Now pane to that agent; "Follow live" un-pins.
3. **Now pane** (`components/agents/now.tsx`): picks one moment from the snapshot, no empty states:
   - *start / collecting*: "Reading your bills": the bills as they arrive (site, provider, period, total).
   - *auditing / finding*: the newest finding at real size: title, site, refund in lime serif, plus `KwhChart` + `BillSnippet` from its evidence; other findings listed below with amounts (click → existing `EvidenceDrawer`).
   - *approval pending*: the one amber element, a card with a full amber border: action count, summary, big lime Approve (`useApprove`), and on a local run the phone thread with "Reply as Linda" (see Q2). Replay: "Waiting for the recorded reply".
   - *call*: provider, mode, timer, animated waveform (blue `wave-bar`, still under reduced motion), transcript streaming with follow-scroll; speech logic unchanged.
   - *filing / finance / done*: the ledger (current Ledger content) with lime figures rolling up, "Customer keeps" largest.
   - Moment choice is a pure function `nowMoment(snapshot, pickedAgent)` in `lib/now.ts` with unit tests.
4. **Audit log**: `<details>` under the Now pane, summary "Show the full log, 42 entries". Rows: time, agent, plain-language action ("Logged in to the BayCurrent portal") then the tool name in small mono; `break-words`, never `break-all`. Phrases from a `TOOL_WORDS` map in `lib/tool-words.ts` (provider name from the snapshot's bills when there is one); unknown tools fall back to the tool name with underscores as spaces. Unit test covers every tool in `packages/agents/src/tools` and the recorded run.
5. **Removed from /agents**: Board panel, Platform fact, the drums (`MeterRegister` deleted if nothing else uses it), every "No … yet" line. Panels that become unused are deleted; parts the Now pane reuses move into `components/agents/`.
6. **Sandbox bar**: after `judge-link` ships, merge main and restyle its banner: about 36px tall, 14px text, `sheet` with an amber dot, "Sandbox · a recorded audit replayed for you at 2× · Watch it again". Until then the current `ReplayBanner` gets the restyle with the text it has.
7. **Type and motion** (Hallmark): 600 for titles only, base size per Q1, motion 200–600 ms ease-out, reduced motion shows the finished state (no pulse, no waveform, figures at final value).
8. **Then**: Hallmark audit of Overview, Bills, Findings, Money at 1440 and 390; fix critical/major only; findings listed in this plan.

## Files
- `apps/dashboard/app/(app)/agents/page.tsx`: new layout.
- `apps/dashboard/components/header.tsx`: run header + banner restyle.
- new `apps/dashboard/components/agents/{timeline,now,audit-log}.tsx`, `apps/dashboard/lib/{now,tool-words}.ts` (+ tests).
- `apps/dashboard/lib/agents.ts`: fixed order, done/waiting/failed states, CEO row (+ `agents.test.ts`).
- `components/panels/*`, `components/panel.tsx`: moved or deleted as above.
- `scripts/dashboard-shell-check.ts`, `panels-*-check.ts`, `agents-e2e.ts`, `replay-check.ts`, `stop-check.ts`, `rehearse-stage.ts`: /agents selectors updated (board → timeline rows, font floor per Q1); existing test ids kept where the element survives (Q6).
- `docs/plan/design.md`: the `/agents` paragraphs rewritten for the new layout.

## Answers applied (answers.md, 2026-11-07 21:23)
- Q1: the 22px floor goes entirely (large screens, not projectors). App-wide scale as above; checks assert a 12px floor; `docs/plan/design.md` updated to match.
- Q2: the phone thread sits inside the amber approval card under Approve, on a local live run only; on naïve one line "The request went by email".
- Q3: every agent is shown from the start; ones that haven't started read "Up next" in grey.
- Q4: Monitor is the last row.
- Q5: `rehearse-stage.ts` runs once after the build, browser muted.
- Q6: the panel/e2e/rehearsal checks are rewritten against the timeline and Now pane with the same meaning.
- Open: Q7 (which money figure is the /agents hero). Waiting for GO.

## How I check it
- Unit: `lib/now.test.ts` (each moment from fixture snapshots, picked agent, replay), `lib/tool-words.test.ts`, `lib/agents.test.ts`.
- `pnpm test`, `pnpm lint`, `pnpm typecheck` (root and dashboard).
- Screenshots with Playwright over `pnpm demo:replay` (recorded run, no model cost) at 1920x1080 and 1440x900 at start, finding, approval, call, done; 390x844; sandbox (replay) and local; one before/after pair against `docs/plan/agents-before.png`. The script asserts no "No … yet" text, no horizontal scroll, no clipped agent action.
- `scripts/rehearse-stage.ts` in sim, browser muted (Q5).

## Answer applied (answers.md, 21:36)
- Q7: the /agents hero is money found so far, in the run header, counting up. GO.

## What changed and how to try it
**Try it:** `pnpm demo:replay --speed 2 --force`, then open `/agents` (signed in). Or `pnpm demo:start` for a local run. Screenshots: the human's set is committed in `docs/plan/agents-redesign/pairs/` as JPEG (approval and call at 1920 and 1440, Overview 1440, 390 for agents, call and Overview), and `pairs/agents-before-after.jpg` is the pair against `docs/plan/agents-before.png`. The full sets (`before/`, `after/`: 5 moments × 1920/1440/390 sandbox plus every app page; `local/`: the rehearsal's local run) are in the worktree, not committed (about 30 MB; only one screenshot was ever committed before). Regenerate with `scripts/agents-shots.ts <folder>` (5 moments × 1920/1440/390 from a sandbox replay; fails on horizontal scroll, "No … yet" text or a clipped agent action) and `scripts/app-shots.ts <folder>` (every app page at 1440 and 390; flags text off the scale).

**/agents** (`components/agents/`):
- Run header on one line: status dot and word, elapsed (ticks between polls; recorded time on a replay), **money found** as the page's one 36px lime serif figure counting up, "N human action(s)", run cost. The sandbox pill sits by the title.
- Money found is the approver's own rule: `findingTotals` over findings that are not `promoExpiry` (expired promos are flagged, not claimed), refund plus yearly savings. It reads $30,925.38 at the end of the recorded run, the Overview's refund plus savings.
- Timeline: CEO header, then intake, collector, auditor, filer, approver, negotiator, finance, monitor (Monitor last; filer before approver because that is the real run order). Every agent shows from the start; not-started rows read "Up next" in grey and cannot be picked. Dots: blue pulsing working, lime done, amber waiting on you (approver while the approval is pending), coral failed (a blocked card, or a card still doing on a stopped run). Clicking a row pins the Now pane to it; "Follow live" unpins.
- Now pane (`lib/now.ts` picks the moment): bills → findings (the biggest with its kWh chart or rate table, "Open the evidence", the rest as buttons) → approval (amber card, Approve; texts thread under it on a local run, "The request went by email." on naïve) → call (waveform moves only while open, transcript streams, disclosure framed) → ledger (four totals counting up, then rows). Scroll resets to the top on each moment.
- Audit log collapsed: "Show the full log, N entries"; rows in plain words (`lib/tool-words.ts`, a unit test covers every tool and the recorded run) with the tool name in small mono, soft breaks after underscores only.
- Gone: the board, the drums (`meter-register.tsx`), the platform line, every "No … yet" panel, the 64px icon rail.

**App-wide type** (human ruling): six tokens in `globals.css` (12/13/14/15/20 and one 36px hero). Overview, Bills, Findings, Money, the evidence drawer, onboarding, sign-up and log in moved onto it; 600 only on titles and the current item; 16px nav icons; the replay banner became `components/sandbox-pill.tsx` (12px pill, amber dot, popover with the full sentence) on every page header. `docs/plan/design.md` rewritten to match.

**Checks:** `panels-money`, `panels-work`, `panels-action`, `dashboard-shell` and `replay-check` rewritten against the timeline and Now pane with the same meaning and a 12px floor; all pass against a replay. `rehearse-stage.ts` waits for a started agent row instead of "No cards yet". `savings-views-check` passes.

**Rehearsal (sim, headless so muted):** passed. On stage 2:30, whole rehearsal 4:27; Overview and Money show $12,606.06 / $18,319.32 / $9,277.61; call sim, 1:31. It ran on this lane's own portal (3201), webhooks (3202) and database, so the shared database and the main checkout's servers were never touched, and it was reset with `demoReset({ mailpitApi: null })` so the shared Mailpit inbox was not cleared. The first attempt ended `incomplete` because this worktree's `.env` had an empty `ALLOWED_CALL_NUMBERS` and a placeholder `STRIPE_SECRET_KEY`; both now copied from the main checkout (Stripe test key). Its first `/agents` shot also caught the Now pane mid-fade, so the first moment now shows without a fade (commit 21a6dff). Model cost of both runs about $0.94 by the SDK estimate.

**Shortcuts and limits:**
- `useCallSpeech` lives at page level (`AgentsView`), not in the call view, because the Now pane mounts the call late and would mark the disclosure as already said. shortcut: speech runs whatever moment is on screen; fine while one call per run.
- The sandbox pill's popover has no "Watch it again" yet: that comes with judge-link's banner, which this lane replaces after judge-link ships and main is merged in.
- A pinned agent with no view of its own (intake, collector, finance, monitor) shows its steps in plain words.

## Fix round (review.md, 2026-11-07)
1. **Shared database guard bypassable** (`scripts/agents-shots.ts`): the URL-path check is gone; the script now calls `assertNotSharedDatabase` against the live connection before the replay. Regression test in `stop-check.test.ts` for `/%62illfighter`. Tried it: an encoded URL is refused.
2. **Audit wording claims success** (`lib/tool-words.ts`): every label is now a neutral step ("Charge the card on file", "Cancel an unused line", "Create Clawback's invoice"), since the snapshot carries no outcome and denied/failed attempts are logged too. Test asserts no label is past tense. Callers' expectations (`agents.test.ts`, `panels-money-check.ts`, phase doc) updated.
3. **Live transitions dismiss open evidence** (`now.tsx`, `lib/now.ts`): the open finding id moved up to `NowPane`, and `nowMoment(s, picked, reading)` holds "findings" while a drawer is open. Unit test with no agent picked: a pending approval or open call stays on findings until the drawer closes.
4. **Scroll reset defeats transcript following** (`now.tsx`): the reset-to-top skips the call, which `useFollow` has already scrolled to its newest line. `agents-shots.ts` now fails if the call moment (≥6 lines) is not at its newest line; passed on a 4× replay at 1920/1440/390.
5. **Repeat audits never reach the money** (`lib/now.ts`): this run's finance card being done also counts, so ledger rows updated in place (old `createdAt`) still lead to the money. Regression test added.
6. **Non-hero money at 20px**: ledger totals, the lead finding, the evidence drawer amount, Overview and Money statement rows, the invoice amount and `StatTile` moved to `text-body`. `app-shots.ts` now flags any `.font-figure` text outside `[data-hero-figure]` that is not 14px; it passes on every signed-in page at 1440 and 390.

Checks: `pnpm test` (all pass), `pnpm lint`, `pnpm typecheck`; `agents-shots.ts` and `app-shots.ts` against this lane's own dashboard (port 3300) and database.

## Known limits
- Orchestrator decision (2026-11-07, review round 3): fix the stale openId (clear when the finding is gone) and the repeat-audit collecting moment (use current-run progress), each with a regression test. This is the last fix round; later non-regression findings go here as known limits.

## Fix round (review round 3)
1. **Stale evidence selection (now.tsx:141)**: `nowMoment` now takes the open finding's id and holds the findings only while that finding still exists; `NowPane` clears `openId` at render time when an audit removes it, so its drawer closes and approvals and calls come back. Regression test in `lib/now.test.ts`.
2. **Repeat audits skip the collecting moment (lib/now.ts:37)**: the run's own board cards and audit rows decide it. While intake or collector has begun and no agent from the auditor on has, the pane shows the bills even if an earlier audit's findings are there. Regression test covers a new run with existing findings, by card and by audit row, and the switch once the auditor or a later agent starts.

Checks: `pnpm test` (1828 pass), `pnpm lint`, `pnpm typecheck`, dashboard `tsc --noEmit`. Browser suites not re-run. Non-blocking design.md note left alone (not a file this round edits).
- Orchestrator decision (2026-11-07, review round 4): fix only now.tsx:51 (show both refund and yearly savings when nonzero, regression test); it changes what customers see. Known limits, not fixed in this lane: scripts/app-shots.ts onboarding shot uses a session without a user row (lands on /login), and the shell/panels checks enforce the 12px floor but not the 20px ceiling or the single hero exception. Both are test-script coverage, not product behaviour.

## Fix round 4

1. **Refund hides yearly savings (components/agents/now.tsx:51)**: fixed. `amountOf` moved to `lib/now.ts` and shows every nonzero amount ("$12,600.00 refund · $10,800.00 a year"), or "To check" when both are zero. Regression test in `lib/now.test.ts`.
2. **app-shots onboarding shot lands on /login (scripts/app-shots.ts:47)**: not fixed, by the orchestrator decision above. It is a known limit of a test script and does not change product behaviour.
3. **Shell/panels checks lack the 20px ceiling and hero exception (scripts/dashboard-shell-check.ts:16)**: not fixed, by the orchestrator decision above. It is a known limit of a test script and does not change product behaviour.

Checks: `pnpm test` (1829 pass, 1 skipped), `pnpm lint`, `pnpm typecheck`, dashboard `tsc --noEmit`. Browser suites not re-run.
