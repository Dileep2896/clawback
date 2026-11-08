# Handover

The orchestrator rewrites this before it stops, and reads it first when it starts.

## Current session
Picked up 2026-11-06, still running 2026-11-07 about 02:30.

## Running
- All 42 lanes on main (2026-11-07 04:23). Main: 1696 tests pass, 1 skipped. No lanes active. M0 to M9 done; M10 (naive) only when the human asks.
- Rehearsal results and the stage runbook: docs/plan/rehearsal-notes.md. Stage script is option A: start the run before the talk, wait at approval, YES to ledger about 2:55, call about 2:23. Backup: replay at 1.4x, about 3:11.
- Numbers now: refund $12,606.06, yearly savings $18,319.32 (3 promos, $3,240.00, found but not acted on), fee and invoice $9,277.61.
- Voice credit estimate after 3 live calls: Retell about $9.18, Vapi about $4.41; option A call about $0.40. Read the dashboards before the talk.
- A fresh worktree lacks .env, .vault/, data/bills/ and portal logins (all gitignored); see rehearsal-notes.md "Setting up a fresh worktree".

## Decided 2026-11-08 (human, terminal)
- "I am happy with the UI too. Once everything is done, re-record our demo video and finalize it too." Treated as: ship approval for agents-redesign, judge-link, email-negotiator and the demo-video tool once each is review-clean (recorded per lane with this quote); then one sandbox redeploy (human runs pnpm sandbox:redeploy); then one live run to re-record the video (about $1.18: Retell ~$0.23, Vapi ~$0.17, Claude ~$0.78; floor $3 Retell / $2 Vapi), reuse the nine voice clips, final render to ~/Desktop/clawback-video/.
- "go ahead": baytel.example added to ALLOWED_EMAIL_DOMAINS (root .env done). Email option in the judge sandbox too.

## Waiting on the human
- Human, 2026-11-08: "we can ship once UI is perfect on the judge and the video". Hold judge-link and demo-video; agents-redesign merges fleet/judge-link into its branch and the human reviews the combined UI in the preview first. Then ship judge-link, agents-redesign, demo-video; one sandbox redeploy; decide the video re-record.
- Confirm the agents-redesign UI (screenshots), then decide whether to re-record the demo video (one more live run, about $1.18). Human: "no let me first confirm the UI then we can re-record". The current ~/Desktop/clawback-video/demo-final.mp4 shows the old /agents page.
- "ship" for demo-video (review-clean after the merge).
- Listen to the offline replay speech (Mac local voices).
- Choose a stage script from rehearsal's options. The slot is 3 to 4 minutes and must include a real live call, but the call alone is about 3 minutes and a full live run 5:18.
- Record the backup video into a local folder outside the repo (human will do it).

## Decided
- Human, 2026-11-07 terminal: naïve rehearsal run 2 is void; the old naïve key is revoked. New dark colour theme (phase 13). New task landing-pages. Venue uses big Samsung screens, not projectors: projector check dropped. Human approved one live run to record the demo video ("yes, plan one live run for the video"); task demo-video. Voice credit confirmed by the human: Retell $8.25, Vapi $4.25 (floor for stage: $3 Retell, $2 Vapi). Approved the naïve flag probe (done, $0.001) and one Sonnet measurement run (cap $2) for naive-runtime-cost.
- Human, 2026-11-07: phase 13 product UI (rename to Clawback for everything users see, sign-up with PDF upload or portal login, customer app plus /agents, stage opens on sign-up). Started M10 recon. naïve answers: new key without billing:write (human makes it); no phone number, approval by email plus tap; human renames the org to Clawback; cloudflared quick tunnel OK during naïve runs only, exposing only the MCP tool server behind a vault bearer. naïve has $250 credit. Neon, Mobilerun, Monid: not used. New key in root .env (no billing:write), checked with GET /v1/me; old key should be revoked by the human. Org renamed "ClawBack"; system domain stays new-company-qffcxs.usenaive.ai (human: "keep it for now"), its dns_status was pending_verification at 13:20, so sending waits on naïve.
- Human, 2026-11-07, in the terminal: slot 3 to 4 minutes; real live call on stage with replay as backup; human records the backup video; yes to re-provisioning the Retell caller and the Vapi line and ONE live rehearsal call. No second call without asking.
- Voice credit (human read it after test call 1): Retell $9.70, Vapi $4.79. Call 1 cost $0.2575 Retell plus $0.19 Vapi, 161 s. Keep at least $3 Retell and $2 Vapi for the stage. Human: "We don't want to spead free credits completely, as we want some for demo".
- Test call 1 passed: disclosure first (human listened: "okay it looks good"; two Whisper models agree), keypress 2, 7 of 7 lines, 3 of 3 promos, ticket BT-48213. The Vapi check flag was speech-to-text ("AIS assistant").
- Root `.env` has RETELL_CALLER_AGENT_ID and RETELL_CALLER_AGENT_VERSION=0. Both agents still run the OLD prompts; main has the new answering prompts from voice-caller-answers.
- Caller answers: authorised question names Linda Park and the approval date. Unknown answer: "Linda Park, the account holder, can confirm that, and your question is on the record of this call. For today, may I continue with the approved changes?" Never promises a callback. Auto-approved runs never dial live. An off-plan request fails the live call. Rep asks one new turn: service address and who authorised, about +18 s.
- The product's agents read the owner's private Claude Code memory until demo-replay set CLAUDE_CODE_DISABLE_AUTO_MEMORY. Earlier agents-e2e greens ran with that memory and count for less.
- Approval text is built in code from the bundle and lists the promo restores. Runs that stop before the plan finishes read `incomplete`; a verified no-fee refusal does not.
- Replay: about 1.7x fits a 190 s window (3:07 run, 1:11 call), always labelled replay; YES is posted by script during capture.
- STANDING APPROVAL (human, terminal, 2026-11-06): "Okay I have seen all the plans, so approve everything until we have a working demo and keep on building, You can ask me when it comes to actual API which cost us money, but till then just keep on building". Recorded per lane through M9. Still ask before every live call, provisioning and paid API. Not M10.
- Earlier decisions: local-first, naive only at M10 when the human asks; Telegram approvals only from user id 7355496775 as a direct reply with a clear yes; prebuilt code allowed; no ANTHROPIC_API_KEY, Claude Code login only; ALLOWED_EMAIL_DOMAINS includes goldengatenoodle.example.

## Next
- Ship demo-replay, run `pnpm test` on main, `fleet cleanup demo-replay`, then tell rehearsal to start.
- Watch rehearsal for: a false incomplete stop card on a good run, two send_email rows, the approval panel showing promos at 1080p, timings against the slot.
- Before the live call, ask the human with credit stated. After it, report real cost and remaining credit.
- Telegram MCP failed to connect this session; the human needs `/mcp` for updates there.
- Known open: a SIGKILLed run reads running until demo:reset; a run can overshoot the budget by up to about $0.81; card_pay has no approval wording (naive lanes).
