# naïve rehearsal notes (M10)

Lane `naive-rehearsal`, 2026-11-07. Goal: `check-platform` green on naïve, three `demo:reset` + `demo:start` runs on naïve with `VOICE_MODE=sim` and the dashboard tap, then the flip back to local. The human's limit: at most 4 naïve runs, at most $8 in total, $2 cap per run.

**Status: stopped after run 2.** No run has passed yet. See "Runs" and "Open".

## Setup (this worktree only)

- Own database `clawback_naive_rehearsal`: `pnpm db:migrate`, `pnpm seed`, `pnpm seed:portal`. For rehearsal only (human: "Yes, rehearsal only"), Linda's `contact_email` in that database is `linda@new-company-qffcxs.usenaive.ai`, the stand-in inbox, so the approval request and summary really arrive.
- Worktree `.env` only, never the main `.env` or `.env.example`: `new-company-qffcxs.usenaive.ai` added to `ALLOWED_EMAIL_DOMAINS`; `NAIVE_DOMAIN_ID`, `NAIVE_INBOX_ID` (bills@), `NAIVE_LINDA_INBOX_ID`; `WEBHOOK_PORT=3012` and `WEBHOOK_URL`, because the main checkout's webhook holds 3002; dashboard 3010, portal 3011.
- Code: on naïve, the webhook service delivers the provider's bill email through local Mailpit (`billMail` in `services/webhooks/src/bill-email.ts`). Before this, naïve Mail refused the BayCurrent sender and `demo:start` could not start a run. `WEBHOOK_PORT` can now be overridden.
- Each run: `pnpm demo:reset`, then `PLATFORM=naive VOICE_MODE=sim pnpm naive:tunnel -- pnpm dev:webhooks`, then start, tap (`POST /api/approve` with a signed dashboard session) and wait. The tunnel is closed after every run.

## check-platform

`PLATFORM=naive pnpm check-platform`: **All checks passed (2 N/A)**. 11 PASS. `Sms` reports N/A (send answers 501 `feature_not_configured`; receive and list work), and `Card` reports N/A (issuing 501, local mock card). Neither is shown as a pass. The domain is `dns_status: provisioned`, and the mail check sent one real email.

## Runs

| Run | Model | Result | Time | Parks (`naive_tool_confirm`) | naïve cost (balance) | Recorded `runs.cost_usd` |
|---|---|---|---|---|---|---|
| 1 | Sonnet 5.5 | `over_budget`, but all the work was done | 13:13, tap at 6:21 | 68 (CEO 28) | $1.9743 | $2.1473 |
| 2 | Haiku 5.5 | `error`: the Mac went to clamshell sleep at 15:11:46, mid-run; `api.vetta.sh` stopped resolving | 3:29, before approval | 2 | $0.0026 | $0.0021 |

Total so far: **$1.9769** of $8 (balance $250.7702 → $248.7933).

Run 1 in detail: Linda Park approved by `dashboard`, and all 19 actions are `done` (7 cancels, 10 letters, call, invoice). The ledger shows refund $12,606.06, savings recorded $18,319.32, fee and invoice $9,277.61, which are the stage numbers. The summary `send_email` reached the Linda inbox. The $2 cap was hit during the CEO's final turn, so the run reads `over_budget`, not success.

Run 2 says nothing about Haiku. The machine slept, and the run failed on network loss (`GET /sessions/.../events: no answer within 30 s`, then `ENOTFOUND api.vetta.sh`). Its cleanup could not reach naïve either.

## Found

- **The run is too expensive on Sonnet.** Ungated MCP tools still park once a session has read the bill text (the trap in `naive-notes.md`). Each park costs the model an extra turn to re-issue the call. 68 parks made a full Sonnet run about $2, and the run took 13 minutes against about 5 on local.
- **A board-digest session started anyway.** After run 1, `ses_ya8ncd5qd4833z5fdkw0mxdyhy` (CEO agent, `metadata.board.digest` with two cards of board `brd_asax4ws3ykz793cg1p1r27tzj8`, no root) was left `awaiting_approval` on `send_to_agent`. `naive-notes.md` says the coordinator's board is off, so digests should not start. The run's cleanup cancels only its root, so this session stayed parked. It costs nothing while parked.
- **Run 2's root `ses_02p474wmn2xcj9dj7fmnk3pn9p`** was left `awaiting_delegation`, because cleanup had no network.
- Both sessions are still open: the cancel call was blocked by a permission check in this lane. Cancel them (`POST /v1/sessions/{id}/cancel`) before the next run.

## Follow-ups

- **(c) Cut the re-issue turns** (`naive-runtime-adapter`, not this lane). Every park the adapter allows still costs a model turn. Options: keep board mirroring out of the model's tool calls (the CEO's 28 parks were mostly `board_update`), or find a naïve setting that keeps `allow` from turning into `ask` after mail text. That would bring a Sonnet run well under the $2 cap and shorten it.
- Track or turn off board-digest sessions, and cancel every session recorded for the run on stop, not only the root.
- Keep the machine awake and on power during a naïve run, for example `caffeinate -i` (lid open). A sleep mid-run ends the run in `error` and leaves sessions behind.

## Open

- Runs 3 and 4 (the limit) and the flip back to `PLATFORM=local` have not been done.

## naive-runtime-cost (2026-11-07)

### Flag probe (live, Haiku, $0.0010)

`packages/platform/src/naive/flag-probe.ts`: one agent, one ungated MCP tool (`allow`), asked to call it twice. The human approved it, with a session cap of $0.10. Both sessions were cancelled afterwards, and `GET /v1/sessions` showed none still open. Balance went from $248.7933 to $248.7923.

| Session | First message | Calls | Parks | Cost | Time |
|---|---|---|---|---|---|
| A `ses_grqbfmymbb60r9n1y3xemk7jpg` | bill email as JSON + task | both in one model step | **0** | $0.0004 | 16 s |
| B `ses_8kbvfjvakcadp6vkd4avmnapp2` | task only, no email | one, then the next after its result | **1** | $0.0006 | 25 s |

What the events show:
- **The email in the first message does not flag the chat.** A read the email and parked nothing.
- **An MCP tool result flags it.** In B, the call made after the first result came back `tool.completed` with `is_error: true` (refused). The model was called again (2 model requests), re-issued the call, and that one parked as `tool.confirm`.
- **Our allow costs no model turn.** After `tool.confirm.resolved` the tool ran straight away (`tool.started`, `tool.completed`), and only then did the model continue. The extra cost of a park is naïve's refusal plus the model's re-issue, which happen before the park.
- So the parsed-facts root message (`runPrompt`) is **not needed**, and was not changed. The lever is fewer MCP calls in each chat once it has seen a result, and a coordinator that never sees one, because a flag is passed on to every chat it delegates to.

### What changed

- The CEO is not offered `board_update` on naïve. The runtime makes one card per delegated member task (through the run's own `board_update` handler, so it is audited and `board_cards` stay the dashboard's record), and moves it to `done` when the member's result comes back (`thread.idle`), or to `blocked` if the member failed or never reported. The CEO's first MCP result is now its summary `send_email`, so it stays unflagged while it delegates and its members start unflagged.
- The copy of our cards to naïve's board is gone. Cards that reached `done` or `blocked` there started the board-digest sessions.
- When a run stops, every session it owns is cancelled (root and threads), not only the root. A cancel retries every 5 s for up to 5 min while naïve cannot be reached. `409 session_terminal` counts as done, and any session still open is printed by id.
- Every run reports its parks (and how many of them were ungated), its sessions and its duration in the final cost line, and in an `audit_log` row (`naive_run_stats`).

### Measurement run (live, Sonnet 5.5, cap $2)

Run `e23702bd-8b22-4290-a998-a7e04de5c837`, 2026-11-07 17:33–17:46 PST. Own database `clawback_naive_cost`, Linda's `contact_email` set to the naïve Linda inbox (rehearsal-only, as for runs 1–2), portal from this worktree on 3031, `VOICE_MODE=sim`. Approved by `scripts/auto-approve.ts` (the run-local stand-in for the dashboard tap) through a temporary copy of `run-local` that allows naïve. The copy was not committed. Started from `executeRun` directly, so not through `demo:start`, which on naïve needs the webhook change on `fleet/naive-rehearsal`.

| | Run 1 (before) | This run | Target |
|---|---|---|---|
| Result | `over_budget` (work done) | **`success`**, all 19 actions `done`, summary sent | |
| naïve cost | $1.9743 | **$1.7044** (balance $248.7923 → $247.0864) | < $0.75 ✗ |
| Duration | 13:13 | **13:33** (813 s) | < 7 min ✗ |
| Parks | 68 (CEO 28) | **53**: 28 ungated, 12 gated, 13 delegations or coordinator copies (CEO 11) | |
| Sessions | | 11 (root + 10 threads); all cancelled, `GET /v1/sessions` shows none open | |

- **The board works without model calls.** There are 10 cards, one per delegated task, all `done`. The CEO made no `board_update` calls. Its 11 parks are its own `send_to_agent` delegations, which we set to `ask` so the loop can check `wait: true`; these park without a refusal.
- **No board-digest session started** (no write to naïve's board).
- **The targets were missed, because the member threads start flagged.** Every member MCP call parked, including each member's first one (intake 2 of 2, collector 11 for 10 calls, negotiator 9 for 8). The CEO had no MCP result before it delegated, so something other than our tool results flags a delegated thread from its start. Candidates: naïve flags every delegated thread, or a delegation message that carries the bill email does (the root's first message did not, per probe A). That was not tested: no further spend is approved. Each park costs the refusal plus a model re-issue, about 10–15 s per call, which is where the 13 minutes go.

### Still open (needs a decision and spend)

- One Haiku probe (~$0.01): does a delegated thread whose message holds no email park on its first MCP call? If yes, naïve flags every thread, and on naïve every member call costs a park whatever we do. The lever then is the model, not the parks: members on Haiku (`NAIVE_MODEL` is per run today, so this needs a per-agent model), or fewer member tool calls. If no, keep the bill email out of the delegated message.
  - Attempted 2026-11-07 (`flag-probe.ts thread`, cap $0.05): naïve answered `GET /vaults: 429 rate_limited the service is at capacity` before any session started. Cost $0.0000 (balance $247.086357 before and after), and no session was created. Not retried: waiting on the human.
