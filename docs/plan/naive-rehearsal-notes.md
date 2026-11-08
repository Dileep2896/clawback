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
