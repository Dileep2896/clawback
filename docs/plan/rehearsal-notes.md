# Rehearsal notes

## Stage script (Clawback product UI, 2026-11-07)

The slot is 3 to 4 minutes; target 3:30. Sim mode only until the human decides on a live rehearsal. Screen 1920×1080, one browser window.

**Before the talk** (about 2 minutes, nobody watching):

1. `pnpm demo:reset`. Restart `pnpm dev:webhooks` if a run was running.
2. Open `http://localhost:3000`, Get started, sign up as Linda Park, Golden Gate Noodle Co., her seeded email (`CUSTOMER.contactEmail`), password of your choice.
3. Onboarding: "Use the demo login" for BayCurrent, then Start my audit. The page moves to Overview.
4. Wait until the Overview shows "Approval needed" (1:50 to 1:59 in rehearsal). The run waits there for as long as needed.
5. Log out. The landing page is on screen when the talk starts.

**On stage:**

| Step | What the presenter does | Rehearsed |
|---|---|---|
| 1 | Get started, sign up the sample business (Sam Lee, Mission Dumplings, any `@missiondumplings.example` email), Upload, pick `data/sample-bills/mission-dumplings-baycurrent-2026-09.pdf`, wait for it to read | 0:06 to 0:07 scripted, about 0:30 by hand |
| 2 | Log out, Log in as Linda. Overview shows Approval needed | 0:03 scripted, about 0:15 by hand |
| 3 | Approve, then "Watch your agents work" (`/agents`) | under 1 s |
| 4 | Talk over the board, the BayTel call and the ledger filling in, until Run status says Success | 2:22 to 2:36 |
| 5 | Overview: refund $12,606.06, yearly savings $18,319.32, fee $9,277.61, you keep $21,647.77 | under 1 s |

On stage it is 2:33 to 2:46 scripted; with hand typing and talking, about 3:20 to 3:30 (estimated, not yet timed by a person).

`pnpm exec tsx --env-file-if-exists=.env scripts/rehearse-stage.ts [screenshot-folder]` plays all of the above in a browser, types at about presenter speed, prints each step's time, and fails unless the run ends in success with the three numbers. It starts one real sim run.

## Rehearsal runs, product UI (2026-11-07)

Own database `clawback_rehearsal`, `VOICE_MODE=sim`, `scripts/rehearse-stage.ts`. Approved on the Overview each time.

| Run | Start to approval (before the talk) | Sample sign-up and upload | Log out, log in | Approve to Success | On stage total | Numbers | Cost |
|---|---|---|---|---|---|---|---|
| Sim 1 | 1:59 | 0:06 | 0:03 | 2:22 | 2:33 | $12,606.06 / $18,319.32 / $9,277.61 | about $0.41 |
| Sim 2 | 1:53 | 0:07 | 0:03 | 2:31 | 2:43 | same | about $0.41 |
| Sim 3 | 1:50 | 0:06 | 0:03 | 2:36 | 2:46 | same | $0.41 |

Every run ended in success with the same three numbers on the Overview. Sim 3's database showed 13 ledger rows.

## Backup: the replay at 1.4×

The recording did not need recapturing: it holds run-table rows only, and the new pages read the same rows. `scripts/replay-check.ts` passes on the new UI (312 samples, all labelled, call timer 1:39), and the REPLAY banner sits above the app on every page.

**`pnpm demo:replay` starts with a full `demo:reset`, which deletes every sign-up, Linda's too.** A browser already signed in as Linda stays signed in, but logging in again fails until she signs up again. So:

1. Before the talk: `pnpm demo:reset`, sign up as Linda (no need to connect or start), open `/agents`. Do not log out.
2. On stage: `pnpm demo:replay --speed 1.4`, talk over `/agents`; the recording's approval came by SMS. Replay finished in 3:11.
3. End on Overview: the same three numbers, "Approved by Linda Park, by SMS", the REPLAY banner on top.

A sample-business sign-up can still be shown in a private window after the replay has started; it then survives.

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

If the main checkout already serves 3000 and 3001, run this worktree's dashboard and portal on other ports (`pnpm --filter @bill-fighter/dashboard exec next dev --port 3010 -H 127.0.0.1`, portal `--port 3011`) and set `DASHBOARD_URL`, `PORTAL_URL` and `ALLOWED_PORTAL_ORIGINS` to match in this worktree's `.env` only. The webhook port 3002 is fixed. `pnpm demo:reset` also empties the shared Mailpit inbox, which every worktree uses.

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

Re-run 2026-11-07 for the product UI, with the same results as below. The agents' email still goes to `billfighter.local`: `clawback-rename` kept that domain.

- `git ls-files` lists only `.env.example`; no `.env` is committed.
- The only `sk_live_` string is the fake `sk_live_abc` in `finance-invoice.test.ts`, which tests that live keys are refused.
- The only real phone numbers are our own Retell caller and Vapi line. `ALLOWED_CALL_NUMBERS` is the Vapi line only, email goes only to `billfighter.local` and `goldengatenoodle.example`, and portals only to `localhost:3001`.
- `pge.com` appears only as tariff source URLs, a sample PDF URL in `scripts/parse-sample.ts`, and tests that check the allowlist refuses it.
