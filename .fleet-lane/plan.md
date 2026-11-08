# Plan: naive-runtime-cost

## What I found
- naïve docs (`capabilities/tools.md`, "Once a chat has read people's data"): reading contacts, mail, messages or a connected app **flags the chat and every chat it hands work to**; then every MCP tool asks on every call, even at `allow`, and a `scope: "session"` grant does not cover it. So in a flagged run every ungated call of ours parks. A park ends the turn; after our `allow` the model is called again (rehearsal: 68 parks ≈ $2, 13 min on Sonnet).
- The adapter already answers ungated parks itself (`decide()` → allow, no human, no model decision). The cost is the extra model turn per park, so the fix is **fewer parks**, not a faster answer.
- What flags our chat is not proven. Candidates: (a) the root message carries the raw bill email JSON (`runPrompt` in `packages/agents/src/run.ts`), (b) MCP tool results count as "a connected app". The fix differs (see questions).
- CEO's 28 parks are mostly `board_update`. `naive/mirror.ts` copies every card (incl. `done`/`blocked`) to the coordinator's naïve board; naïve starts a board digest "when cards finish or block", which is the stray digest session, even with `board: false`.
- `finally` cancels only the root, once, with `.catch(() => {})`: network down → sessions left parked.

## Changes (all in `packages/platform/src/naive/` + tests)
1. **Board out of model calls** (`agent-runtime.ts`): `board_update` is not offered to the CEO on naïve (not in `tools.configs`, a line in the platform note says the board is kept for it). The loop keeps the board itself by calling the run's own `board_update` ToolDef handler (so `wrapTool` still audits and `board_cards` stay the dashboard's record): `thread.created` → card for that member, title = first line of the delegated task, `doing`; thread ends `end_turn`/completed → `done`; failed/stopped/denied → `blocked`. Removes ~28 parks per run.
2. **No digest sessions** (`mirror.ts`): per answer to Q2, either stop the naïve-console mirror, or mirror only `todo`/`doing` so no card ever finishes on naïve. Plus a sweep (item 3) for safety.
3. **Cancel every run session, with retry** (`agent-runtime.ts`): on stop, cancel every session in `owned` that is not terminal (root, threads), not only the root. Each cancel retries on network error (every 5 s, up to 5 min; `409 session_terminal` counts as done); whatever is still left is printed by id so a person can cancel it.
4. **Fewer flagged reads** (depends on Q1/probe): if the raw email in the root message flags the chat, the root message carries the parsed bill facts instead (this touches `runPrompt` in `packages/agents`, outside the lane, so only with a test proving it). If MCP results flag it, item 1 is the main lever and I note the floor.
5. **Measure parks**: the loop counts ungated parks it answered and gated ones, reported in the final `naïve cost` text line and one `audit_log` row (`naive_run_stats`: parks, ungated parks, sessions, duration).

## How I check it
- Fake-naïve tests in `agent-runtime.test.ts`: ungated parked calls confirmed with no model/owner step and counted; board cards created/moved by the loop from thread events through the handler, CEO toolset has no `board_update`; stop cancels root and every thread; cancel retries after simulated network errors then succeeds; terminal sessions not re-cancelled.
- `mirror.test.ts` for the Q2 choice.
- `pnpm test`, lint, typecheck.
- Live only if approved (Q1/Q3): parks, cost, duration recorded in `docs/plan/naive-notes.md`.

## What changed and how to try it

Answers applied: the naïve board mirror is dropped (Q2), and there is one card per delegated task (Q3). The live probe (Q1) showed that the raw email in the first message does **not** flag the chat; an MCP tool result does. So `runPrompt` was not changed (item 4 dropped).

- `packages/platform/src/naive/board.ts`: our `board_cards` only. `mirror.ts` and `mirror.test.ts` are deleted, so nothing is written to naïve's board and no board-digest sessions start.
- `packages/platform/src/naive/agent-runtime.ts`:
  - On naïve the CEO is not offered `board_update`, and a note in its prompt says so. The runtime makes a card through the run's own `board_update` handler when a member thread starts: titled with the first line of the delegated task, `doing`. It moves the card to `done` on `thread.idle`, to `blocked` on failure or `thread.terminated`, and to `blocked` if the member never reported. The CEO no longer calls MCP tools for the board, but the probes later showed every member thread starts flagged anyway (see Live results).
  - On stop, `cancelAll` cancels every session the run owns (root and threads), retrying every 5 s for up to 5 min while naïve is unreachable. `409 session_terminal` counts as done, and anything left is printed by id.
  - Parks (total and ungated), sessions and duration go in the final `naïve cost:` text line and in an `audit_log` row `naive_run_stats`.
- `packages/platform/src/naive/flag-probe.ts`: the live probe (Haiku, $0.001).
- `docs/plan/naive-rehearsal-notes.md`: cherry-picked from `fleet/naive-rehearsal` (notes only, so the later merge sees the same file) and extended with the probe and the changes.

Try: `pnpm exec vitest run packages/platform/src/naive` (new tests are under "naïve runtime cost"). For a live run, see the measurement section in `naive-rehearsal-notes.md`.

### Known limits
- Board cards on naïve are one per delegated member task, titled from the CEO's task message, not written by the CEO (orchestrator-approved).
- Members still park on every MCP call after their own first result: naïve refuses the call and the model re-issues it. Our allow adds no model turn, but naïve's refusal and the re-issue cannot be avoided from our side.
- Cards and the sessions the run owns live in memory for the run, one run at a time (the demo rule, as before).

### Live results
- Probe (Haiku, $0.0010): an MCP result flags a chat; the email in the first message does not; our allow adds no model turn.
- Sonnet measurement run: **success** (all 19 actions done), **$1.7044, 13:33, 53 parks** (28 ungated). Run 1 was $1.97, 13:13, 68 parks. **Targets ($0.75, 7 min) missed.** Member threads park on every call from their first, so they start flagged for a reason the CEO change does not reach. Details and the next probe proposal are in `docs/plan/naive-rehearsal-notes.md`. All sessions are cancelled, and none are open on the API.

## Fix round
- **Blocking 1, failed tasks can appear done (agent-runtime.ts:283):** on `thread.idle` the runtime now reads the member's session from the API before it picks `done` or `blocked`, so a stale or missing copy can't mark a failed member `done`. The test fake now returns session snapshots, as HTTP would, not shared objects (that sharing is why the old tests could not catch this). New test: "reads a member's own state when its result folds back…".
- **Blocking 2, failed board updates dropped (agent-runtime.ts:137):** a card keeps its mapping until its move is written. A failed move is retried at the start of each poll round and once more at the end. If it still fails, a run that would have succeeded ends `error: board cards not updated: <ids>`. The first outcome wins, so `thread.idle` followed by `thread.terminated` stays `done`. New test: "retries a card move that failed to write, and fails the run if it never lands".
- Both new tests fail on the old code and pass now. Lint, typecheck and `pnpm test` pass (111 files, 1811 tests).
- Non-blocking: the flagging comment (agent-runtime.ts:21) now matches the Sonnet measurement.
- Thread probe (C, `flag-probe.ts thread`), approved 17:54: the one attempt failed with naïve `GET /vaults: 429 rate_limited the service is at capacity` before any session started, so it cost $0.0000. answers.md says not to retry a failed run without asking, so I asked in questions.md.

## Fix round 2
- **Blocking 1, card creation failures disappear (agent-runtime.ts:291):** a card creation is now kept in `creating` until it is written. It is retried in the same `flushCards` round as moves, and a move waits until its card exists. A card never created is marked `blocked` at the end, and a run that would have succeeded ends `error: board cards not updated: "<title>" (not created)`. New test: "retries a card creation that failed to write, and fails the run if the card is never created".
- **Blocking 2, terminal snapshots skip unread events and usage (agent-runtime.ts:298):** `thread.idle` still reads the member's session to pick `done`/`blocked`, but no longer stores it on the entry. The loop then polls that member once more, drains its last events (outputs, confirmation audit rows) and accounts its spend in the loop. New test: "still reads a member's last events and spend when its result folds back as it ends".
- Both new tests fail on the old code and pass now. Lint, typecheck and `pnpm test` pass (111 files, 1813 tests). Commit ec279f3. No `origin` remote, so not pushed.
- Thread probe (C) retried once under the 18:00 approval: **a delegated thread parks on its first MCP call with no email in its message.** naïve flags every thread. Cost $0.0014 consumed ($0.0028 off the balance). No session left open. Next lever (members on Haiku via a per-agent model, fewer member calls) is in `docs/plan/naive-rehearsal-notes.md`.
- Orchestrator decision (2026-11-07, review round 3): make card creation idempotent per thread (agent-runtime.ts:134), then stop. naïve is not the stage runtime; later non-regression findings go here as known limits.

## Fix round 3
- **Blocking 1, card retries duplicate successful creations (agent-runtime.ts:134):** a creation retry now first lists the run's board (`board` dep, read only) and takes the card a failed attempt already wrote (same member and title, not already one of this run's cards), so `wrapTool` throwing after an insert, when only the audit row failed, no longer makes a second card. Without a `board` dep (the probes), the coordinator keeps its own `board_update` as before. New test, through the real `wrapTool` with an audit that fails once: "takes the card a failed creation already wrote instead of making a second one". It makes two cards on the old code and one card, moved to `done`, now.
- Lint, typecheck and `pnpm test` pass (111 files, 1814 tests). Commit 07b4330. No `origin` remote, so not pushed.
- Known limit: two tasks with the same title for the same member, where one creation fails after its insert, may swap cards between the two threads. Each card still ends up moved, and none is duplicated.
- Orchestrator decision (2026-11-07, review round 4): fix only the regression from round 3, the lost audit row on creation recovery (agent-runtime.ts:145). Known limit, not fixed in this lane: on naïve, a member whose gated call is denied and then ends its turn closes its card as done, not blocked (agent-runtime.ts:315); naïve is not the stage runtime and the local runtime is unaffected.

## Fix round 4
- **Blocking 2, creation recovery loses the audit record (agent-runtime.ts:145):** when a retry takes a card a failed creation already wrote, the runtime now writes that creation's missing `board_update` audit row itself (same input and output the wrapper would have written), with no second insert. If that audit write fails too, the creation stays pending and the next round finds the same card and retries only the row. The test "takes the card a failed creation already wrote…" now shares one audit between the wrapper and the runtime and checks that both the creation and the move rows persist; it fails on the old code and passes now.
- **Blocking 1, denied tasks appear completed (agent-runtime.ts:315): not fixed, per the orchestrator decision of 2026-11-07 (review round 4).** It stays a known limit: on naïve, a member whose gated call is denied (or cancelled) and then ends its turn closes its card as `done`, not `blocked`. naïve is not the stage runtime, and the local runtime is unaffected.
- Lint, typecheck and `pnpm test` pass (111 files, 1814 passed, 1 skipped). No `origin` remote, so not pushed.
- Orchestrator decision (2026-11-07, round 5): reversed the deferral above. Fix it: a denied gated call or a cancelled session closes the card as blocked, with regression tests. This is the last fix round for this lane.

## Fix round 5
- **Blocking 1, denied or cancelled tasks appear completed (agent-runtime.ts:324):** the runtime now remembers each thread it denied a gated call on, and on `thread.idle` a thread that was denied, or whose session is `cancelled` (as well as `failed` or stopped), closes its card as `blocked`, not `done`. This replaces the known limit from rounds 3 and 4. New test: "blocks the card of a member that was cancelled, or denied a gated call before it ended its turn"; it fails on the old code and passes now.
- Not covered: a gated call refused by our own tool server (its `onDenied` names only the agent, not the thread) does not mark the thread. That only happens when naïve runs a call we did not allow.
- Lint, typecheck and `pnpm test` pass (111 files, 1815 passed, 1 skipped).

## Fix round 6
- **Blocking 1, cross-package relative import (agent-runtime.test.ts:4):** the test now imports `defineTool`/`wrapTool` from `@bill-fighter/agents/tool-wrapper` (the package's `./*` export) instead of `../../../agents/src/tool-wrapper.ts`. It resolves through the workspace root; `@bill-fighter/agents` is not added to platform's `package.json` because agents already depends on platform and that would make a cycle.
- Non-blocking: the stale "members stay unflagged" line in this plan now matches the probe results. `docs/plan/naive-rehearsal-notes.md:67` left alone (not a file this fix edits).
- Lint, typecheck and `pnpm test` pass (111 files, 1815 passed, 1 skipped). No `origin` remote, so not pushed.
