# Rehearsal notes

## Migrate every database first

Replay adds migration `0003_runs_replay` (`runs.replay`). `/api/live` selects every column of `runs`, so **a database that has not run `pnpm db:migrate` after this merges gets a 500 and an empty dashboard.** Migrate the stage database before rehearsing.

## Playing the backup

Needs only local Postgres and the dashboard. The recording must have been made with the same seed, so run `pnpm seed` if replay says the seed is missing.

```
pnpm dev:dashboard
pnpm demo:replay --speed N
```

- The stage screen is `http://localhost:3000/agents` ("Watch your agents work"). `/` is now the landing page.
- `--speed` is 1 to 8, default 1. It scales every gap by the same factor. Nothing is cut.
- Replay clears the run tables first. It refuses a non-local database and a second replay.
- If a real run is marked `running`, replay refuses. Restart `pnpm dev:webhooks`, then add `--force`, or the live agent writes into the replay.
- The banner stays on until the next reset and states the speed. Approve and the SMS reply are hidden, and their routes return 409.

## Picking the speed

From the committed recording (2026-11-07, Option A): 4:27 whole run, call 2:04 to 3:43 (1:39). 1.4× was played and timed; the rest is worked out from it.

| Speed | Whole run | Call | Speech |
|---|---|---|---|
| 1× | 4:27 | 1:39 | normal |
| 1.4× | 3:11 (played) | 1:11 | 1.4× rate |
| 2× | 2:14 | 0:50 | 2× rate |
| 8× | 0:33 | 0:12 | off, the panel says so |

Use 1.4× as the stage backup: it fits the 3 to 4 minute slot and keeps speech clear.

The audit log shows one `send_email`. The CEO prompt now keeps store and ticket numbers out of the email text, which caused the retry before.

Checked at 1.4× in headless Chromium and Google Chrome at 1920×1080: 243 browser requests, all to `http://localhost:3000`, replay label visible. `lsof` showed the replay process connected only to 127.0.0.1:5433 and the dashboard only to 127.0.0.1. The default speech voice is "Samantha", a local voice, and no remote voices are listed. No person has listened to it yet.

## Recapturing

Do this after any change to agent behaviour, the seed, or what the panels expect. It costs one full run on the Claude Code login.

1. Check `VOICE_MODE=sim` and that `DATABASE_URL` is not the shared database. (The 2026-11-07 recapture ran on the shared `billfighter` database because only rehearsal was active. Do not repeat that while other lanes run.)
2. Start `pnpm dev:portal`, `pnpm dev:dashboard` and `pnpm dev:webhooks`.
3. `pnpm demo:reset`, then restart `pnpm dev:webhooks` if a run was running.
4. `pnpm demo:replay --capture`, then `pnpm demo:start` in another terminal.
5. When the text arrives, post `YES` to `/api/sms`.

A capture that breaks a rule goes to `data/replay/run.jsonl.failed`, with the reason printed, and the good file stays. Then run `pnpm exec tsx --env-file-if-exists=.env scripts/replay-check.ts` with the dashboard running on a database of your own.

## Setting up a fresh worktree

A new worktree lacks gitignored files, and a run then stops `incomplete`:

1. Copy `.env`, `.vault/` and `data/bills/` from the main checkout. The bills must be byte-identical, because the parse cache is keyed by the PDF's hash.
2. `pnpm seed:portal`, or the portal says "Sign-in is not set up yet".
3. `pnpm db:migrate`.

## Rehearsal runs (2026-11-07)

Limit: 2 to 4 minutes per run, `RUN_BUDGET_USD` $5. Cost is Claude Code login usage (estimated) plus voice credit from read-back.

| Run | Mode | Result | Time | Cost |
|---|---|---|---|---|
| Sim 1 | sim, old script | success, Human actions 1, one email | 5:01 | $0.38 |
| Sim 2 | sim, old script | success, same | 1:54 to approval, parked 10:30, 2:43 after YES | $0.40 |
| Sim 3 | sim, old script | success, same | 5:12 | $0.41 |
| Live 1 | live, old script | success, call 3:04 | 6:14 | $0.51 voice |
| Sim check | sim, Option A | success, one `send_email` | 4:36 | $0.39 |
| Live 2 | live, Option A | success, call 2:23, no fallback | 5:24 | $0.40 voice |

Every whole run is over 4 minutes, so the stage starts the run before the talk and waits at the approval (project.md §19). From YES to the first ledger row took 2:55 in live run 2. All runs are well under $5.

Voice credit left after live run 2 (estimated from the starting figures): Retell about $9.18, Vapi about $4.41.

## Promos are off the call

Option A takes the three expired promos off the call to keep it short. They stay open findings (`proposed`), nothing claims them restored or won, and the approval text and email name them as still open.

| Figure | Before | Now |
|---|---|---|
| Refund | $12,606.06 | $12,606.06 |
| Yearly savings recorded | $21,559.32 | $18,319.32 (the 3 promos, $3,240.00, are found but not acted on) |
| Fee and invoice | $10,249.61 | $9,277.61 |
| Ledger rows | 16 | 13 |

## Safety search

- `git ls-files` lists only `.env.example`; no `.env` is committed.
- The only `sk_live_` string is the fake `sk_live_abc` in `finance-invoice.test.ts`, which tests that live keys are refused.
- The only real phone numbers are our own Retell caller and Vapi line. `ALLOWED_CALL_NUMBERS` is the Vapi line only, email goes only to `billfighter.local` and `goldengatenoodle.example`, and portals only to `localhost:3001`.
- `pge.com` appears only as tariff source URLs, a sample PDF URL in `scripts/parse-sample.ts`, and tests that check the allowlist refuses it.
