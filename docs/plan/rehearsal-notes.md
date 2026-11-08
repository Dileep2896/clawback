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
| 1 | Get started, sign up the sample business (Sam Lee, Mission Dumplings, any `@missiondumplings.example` email), Upload, pick `data/sample-bills/mission-dumplings-baycurrent-2026-09.pdf`, wait for it to read | 0:06 to 0:07 scripted, 0:24 at hand speed |
| 2 | Log out, Log in as Linda. Overview shows Approval needed | 0:03 scripted, 0:14 at hand speed |
| 3 | Approve, then "Watch your agents work" (`/agents`) | under 1 s |
| 4 | Talk over the board, the BayTel call and the ledger filling in, until Run status says Success | 2:16 to 2:36 sim, 3:05 live |
| 5 | Overview: refund $12,606.06, yearly savings $18,319.32, fee $9,277.61, you keep $21,647.77 | under 1 s |

On stage it is 2:27 to 2:46 in sim at script speed, and **3:49** in the one live run at hand speed (step 1 0:24, step 2 0:14, step 4 3:05).

`pnpm exec tsx --env-file-if-exists=.env scripts/rehearse-stage.ts [screenshot-folder] [--hand] [--live]` plays all of the above in a browser, prints each step's time, then checks the Money page outside the stage clock. It fails unless the run ends in success with the three numbers on both the Overview and Money. It starts one real run. `--hand` types and clicks at a person's pace. `--live` needs `VOICE_MODE=live` on both the script and `pnpm dev:webhooks`, and places a real call.

## Rehearsal runs, product UI (2026-11-07)

Own database `clawback_rehearsal`, `VOICE_MODE=sim`, `scripts/rehearse-stage.ts`. Approved on the Overview each time.

| Run | Start to approval (before the talk) | Sample sign-up and upload | Log out, log in | Approve to Success | On stage total | Overview numbers | Money page | Cost |
|---|---|---|---|---|---|---|---|---|
| Sim 1 | 1:59 | 0:06 | 0:03 | 2:22 | 2:33 | $12,606.06 / $18,319.32 / $9,277.61 | Money not checked | about $0.41 |
| Sim 2 | 1:53 | 0:07 | 0:03 | 2:31 | 2:43 | same | Money not checked | about $0.41 |
| Sim 3 | 1:50 | 0:06 | 0:03 | 2:36 | 2:46 | same | Money not checked | $0.41 |
| Sim 4 | 1:49 | 0:06 | 0:03 | 2:16 | 2:27 | same | same three amounts | about $0.41 |
| **Live 1** (hand speed) | 1:44 | 0:24 | 0:14 | 3:05 | **3:49** | same | same three amounts | run $0.76; call $0.3911 |

Sim runs typed at about 60 ms a character with no pauses. Every run ended in success with the same three numbers on the Overview. Sims 1 to 3 ran before the Money check existed; Sim 4 (after the review) checked Money too and found the same three amounts, with a 1:30 sim call. Sim 3's database showed 13 ledger rows.

**Live 1** (2026-11-07, `scripts/rehearse-stage.ts --hand --live`, typing at 200 ms a character with a 1.5 s pause before each click; the file picker counts double):

- One call, to the allowlisted Vapi line only. Retell `call_1464114e1fb2df0d96955a6ba4d`, Vapi `01a1b7ea-45a3-7000-979c-5eb62487a4a5`.
- The call lasted 2:19 (140 s) and ended `agent_hangup`, a normal end. `calls.mode` is `live` and a ticket was saved, so it **did not fall back** to sim.
- Cost from read-back: Retell $0.2266, Vapi $0.1645, call **$0.3911**. The run's own cost was $0.755772.
- Credit left (estimated from the figures before): Retell about $8.95, Vapi about $4.25.
- Live, approve to Success took 3:05, against 2:22 to 2:36 in sim. That puts on stage at **3:49**: inside the 4-minute slot but over the 3:30 target. To get back to 3:30, shorten the talk over the sample-business sign-up (0:24) or skip the log-out and log-in by using a second browser profile already signed in as Linda (0:14).
- Overview and Money both showed refund $12,606.06, yearly savings $18,319.32 and fee $9,277.61, with 13 ledger rows.
- No agents were re-provisioned. The webhook service ran with `VOICE_MODE=live` only for this run and was stopped right after; `.env` stays `VOICE_MODE=sim`.

## Demo video take (2026-11-07)

The one live run for the video, approved by the human ("yes, plan one live run for the video"), recorded by `video/record/record-demo.ts --live` (see `video/README.md`). Own database `clawback_video`, this worktree's dashboard, portal and webhooks on 3010, 3011 and 3012; the main checkout was not touched. One sim dry take ran first to prove the recorder (about $0.41 Claude, no voice).

- Not a replay: no REPLAY banner, Linda tapped Approve on the Overview. Before the take (not filmed), Linda signed up, connected BayCurrent and waited at approval. On camera: landing, Mission Dumplings sign-up and sample-bill upload (committed parse, no model call), cut to Linda, `/agents` and the meter finding's kWh chart, Approve, `/agents` to Success, Overview, Money.
- One call, to the allowlisted Vapi line only. Retell `call_9f91b9b03912b638932abf8523d`, Vapi `01a1b92f-dae9-7000-b755-4e5a0fdcf12d`. 2:25 (144.6 s), ended `agent_hangup`, `calls.mode` live, no fallback.
- Cost from read-back: Retell **$0.2340**, Vapi **$0.1695**, call $0.4035. Claude (the run's own cost) **$0.781321**. Take total about $1.18.
- Credit left (from the human's figures before: Retell $8.25, Vapi $4.25): Retell about **$8.02**, Vapi about **$4.08**, above the $3 / $2 floor.
- Approve to Success 3:18 (live 1 above: 3:05). The whole take filmed 4:31.
- Overview and the checks: refund $12,606.06, yearly savings $18,319.32, fee $9,277.61, 13 ledger rows. Same as every run, so the voiceover's figures stand.
- The line's own check (`cli.ts readback`) listed three notes: "the first thing said was not the menu" (our disclosure plays first), and two lines its transcriber heard as "baseball business" and "you i have the account". The scripted line is "Thanks for calling BayTel Business"; Retell's transcript heard "Basal Business", corrected to BayTel in the video's captions only. The keypad press (2) was right.
- Live mode was on only for this take: the webhook process ran with `VOICE_MODE=live` on its command line and was restarted in sim straight after. `.env` stays `VOICE_MODE=sim`.

## Demo video re-take (2026-11-08)

The one live run for the re-recorded video on the redesigned `/agents` page (after agents-redesign and email-negotiator), approved by the human in the terminal ("Go ahead with one live call."). Recorded by `video/record/record-demo.ts --live`, paced to the voiceover's word timings. Own database `clawback_video`, this worktree's dashboard, portal and webhooks on 3010, 3011 and 3012. The 2026-11-07 take's footage was lost with the old worktree; its render is kept as `~/Desktop/clawback-video/demo-final-v1.mp4`.

- Not a replay: no REPLAY banner. Linda kept the default **Call** on the approval card's Call/Email choice and tapped Approve on `/agents`. On camera: landing, Mission Dumplings sign-up and sample-bill upload (committed parse, no model call), Linda on `/agents` (Collector, Auditor with the kWh chart, the amber card, Approve, the call), Findings, Overview, Money.
- One call, to the allowlisted Vapi line only. Retell `call_cc82cbeda6ad01519ed15c63150`, Vapi `01a1bc18-6ee6-7001-b8eb-c32218fc7cdb`. 2:28 (147.7 s), `calls.mode` live, no fallback, 7 lines cancelled on the call.
- Cost from read-back: Retell **$0.2384**, Vapi **$0.1727**, call $0.4111. Claude (the run's own cost) **$0.792779**. Take total about **$1.20**.
- Before it, three sim dry takes on the new UI (no voice): $0.590, $0.408 and $0.608 Claude. The first failed at Approve on a recorder selector (fixed); the third proved the voiceover-paced recorder.
- Credit left (estimated from the 2026-11-07 figures, assuming no other live calls since): Retell about **$7.78**, Vapi about **$3.91**, above the $3 / $2 floor.
- Approve to Success 3:22. The whole take filmed 4:52.
- Overview and the checks: refund $12,606.06, yearly savings $18,319.32, fee $9,277.61. Same as every run, so the voiceover's figures stand.
- The line's own check listed two notes: "the caller did not open with the full disclosure" (our recorded disclosure plays first, as on 2026-11-07) and one off-script rep line ("what's the service address and who authorized these changes"), which the agent answered. Retell heard "Baytel"; corrected to BayTel in the video's captions only.
- Live mode was on only for this take: the webhook process ran with `VOICE_MODE=live` on its command line and was restarted in sim straight after. `.env` stays `VOICE_MODE=sim`.

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
