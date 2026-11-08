# Plan: demo-video (resumed 2026-11-08)

## Where the lane is
Done and committed on `fleet/demo-video` (591604f..7b6dbf2, not merged):
- Recorder (`video/record/record-demo.ts`, CDP screencast, events.json), call-audio fetch (`call-audio.ts`), Remotion 4.0.528 edit in `video/` (own workspace), scenes re-timed to the human's V1–V9 clips, review fixes (take folders, sim-fallback rejection, Playwright only in `video/record`).
- The one approved live take (2026-11-07): Retell `call_9f91b9b03912b638932abf8523d`, Retell $0.2340 + Vapi $0.1695 + Claude $0.78 ≈ $1.18, logged in `docs/plan/rehearsal-notes.md`. `video/public/events.json` and `scenes.json` are that take's.

## Why I cannot finish
- This worktree was recreated on 2026-11-08 07:16. Everything gitignored is gone: `video/out/take-*` (frames, footage master), `video/public/footage/`, `public/call.wav` + transcript, `public/vo/`, and any rough cut or render. A Spotlight search of the Mac and the Trash finds no copy.
- The voiceover originals survive (`~/Desktop/clawback-voiceover/Clawback/V1–V9.m4a`).
- The call audio and transcript can be fetched again for free (read-only Retell GET for the call id above).
- The screen footage cannot be got back. A new take is needed for it.
- main has moved since the take (`ship: agents-redesign`, 68 dashboard files). A new take would show the new look. The old take showed the old `/agents`.
- This folder held another lane's plan/questions (naive-runtime-cost); kept as `plan.naive-runtime-cost.md` / `questions.naive-runtime-cost.md`.

## If GO for a second live take (option A)
1. Merge main into `fleet/demo-video` (normal route), `pnpm install` in `video/`, check the sample upload still uses the parse cache.
2. Recreate `clawback_video`, sim dry take first (≈ $0.41 Claude) only if you approve it; else straight to the live take.
3. One `--live` take (≈ $1.18), audio via `call-audio.ts` (free), fix "BayTel" in the transcript.
4. Copy V1–V9 to `public/vo/`. Update `events.json`. Check V4/V7 still match the redesigned screens. Re-time `scenes.json`. Render the rough cut, then the H.264 CRF 16 file and the ProRes master. Check for banding. Log the cost in rehearsal-notes.
Checks: `pnpm test` (timeline.test.ts), lint, typecheck; frame review of the render.

## Re-record round (2026-11-08)
Answers: A (one more live take on the new look, GO later), the old render is the fallback, sim dry take first.
- Old render kept: `~/Desktop/clawback-video/demo-final-v1.mp4` and `demo-final-master-v1.mov` (copies; originals untouched).
- main merged (779ca48). The `.fleet-lane/plan.md`/`questions.md` that main tracks (another lane's) were taken as committed for the merge; this lane's copies sit on top, uncommitted.
- Recorder (630e243): Linda's part now runs on `/agents`: Collector, then Auditor picked in the timeline (kWh chart inline, `kwh-plot`), "Follow live" back to the amber card, `approve`, the call in the Now pane (`section[aria-labelledby=now-title]`, events `call-start`/`call-end`), `money-found` logged; Overview and Money unchanged. Playwright stays in `video/record`.
- Email motion card: `EmailCard` in `video/src/effects.tsx`, `emailCardAtSec: 17` on scene 7 (end of the call, no voiceover): envelope + "Prefer email? Clawback can email the provider instead.", ease-out 0.4 s, held 3 s, out by 20.8 s of the 21 s scene. An overlay, not a scene: the edit is 3,541 of 3,600 frames.
- Worktree rebuilt: `.env` from the main checkout with this lane's DB/ports (`clawback_video`, 3010/3011/3012, sim), `clawback_video` recreated and seeded, parse cache checked (sample bill sha + schema 9b2cd3ec committed: no model call). The 11-07 call audio re-fetched (free GET) as a placeholder so the edit builds; the live take replaces it.
- Sim dry take 1 (`video/out/take-2026-11-08T15-24-08-781Z`): landing, sign-up, upload, Collector, Auditor + kWh chart, amber card and Approve all filmed right (frames checked). It then failed waiting for `approval-decision`: after Approve the Now pane moves on and the card unmounts. Fixed in 630e243 (waits for the approval moment to leave, fails on `approve-error`). The run itself went on in sim (≈ $0.41 Claude).
- Checks: eslint, vitest (video, 11 tests), tsc (root and video) pass.
- Sim dry take 2 (`video/out/take-2026-11-08T15-31-29-158Z`): end to end, run `success`, Overview $12,606.06 / $18,319.32 / −$9,277.61, sim call 1:53, 228.9 s filmed. Claude cost: dry take 1 $0.590, dry take 2 $0.408 (no voice).
- Rough cut fixes (commit after 630e243): scenes 6–7 zoom on the call head (`call-head`, the call timer; the recorder now logs it), not the whole Now pane; scene 7 starts at `call-start` + 9.8 s so the footage runs on from scene 6; email card moved to the empty band above the captions (top 660).
- Rough cut: `video/out/rough.mp4`, copied to `~/Desktop/clawback-video/rough-dry-take-2026-11-08.mp4`. 1:58.0, 3,541 frames, 1920×1080. Its call audio and captions are still the 11-07 call (placeholder) over a sim call; the live take replaces both.
- Scene timeline: 0:00 landing · 0:13.9 title · 0:21.8 sign-up/upload · 0:31.9 /agents, Collector, Auditor, kWh zoom · 0:51.8 amber card, Approve · 0:59.9 call opens · 1:05.1 call audio (email card 1:22.1–1:25.9) · 1:26.1 Filer/ledger 3× · 1:38.6 Overview count-up · 1:51.1 close.

### Live take checklist (when GO)
Merge main (email-negotiator; the take keeps Call), recreate `clawback_video`, restart the webhook process with `VOICE_MODE=live` on its command line only, `record-demo.ts --live`, put the webhook back in sim, `call-audio.ts <id>`, fix BayTel in the transcript, `cli.ts readback` for cost, re-time scenes, render rough → final (CRF 16 + ProRes HQ), loudnorm, banding check, cost in rehearsal-notes, final to `~/Desktop/clawback-video/demo-final.mp4` (v1 already kept).

## Sync round and live re-take (2026-11-08)
Answers: fix the voice/box sync (one box per spoken thing, word timings from local Whisper), then GO for one live take.
- Word timings: `video/record/vo-words.ts` (whisper.cpp small.en, local; speech onset from the leading silence; misheard words set to the script's) → `video/src/vo-words.json`.
- Highlights (`scenes.json`): each names the phrase (`say`, held to the end of `to`) and the logged element. The box shows 0.2 s before the word, the camera springs to that element (sized to about half the frame, 1x to 1.6x), and `footage.atWord` puts the Approve click on "tap". No scene-wide zooms or speed-ups any more (scene 7 keeps a fixed zoom on the call head; it has no voice).
- Recorder paced by the same word times, logging every element in the sync map: upload field, provider-login tab, Collector row, its bills table, Auditor row, the finding, the meter-swap marker, "Fremont #1", the kWh bars, the approval card, Approve, the call head (waveform through timer), the 7 cancelled lines and 3 promos and the claim on Findings (all on one screen), then refund, savings and fee on the Overview.
- Proof: `syncProblems` (each boxed element logged before its word) and `video/record/sync-sheet.ts` (one still per highlight). Commits 801beb3 and 87cb4bb; tests 17 pass, lint and typecheck (root, video, and video/record with DOM lib) pass.
- Sim take 3 ($0.608) proved it; then **the one live take**: success, one call (2:28, live, no fallback), Retell $0.2384 + Vapi $0.1727 + Claude $0.7928 ≈ $1.20, logged in rehearsal-notes with the credit left (≈ $7.78 Retell, $3.91 Vapi, estimated). Webhook back to sim right after.
- Call audio aligned to the footage (starts 6.9 s into the recording, so the timer and the audio agree). Captions: "Baytel" → BayTel.

### What changed and how to try it
- Final: `~/Desktop/clawback-video/demo-final.mp4` (1:58.2, 1920x1080, H.264 CRF 16, −16.2 LUFS, peak −1.5 dB) and `demo-final-master.mov` (ProRes HQ). v1 kept as `demo-final-v1.mp4` / `demo-final-master-v1.mov`.
- Sync sheet: `~/Desktop/clawback-video/sync-sheet-2026-11-08.png` (18 stills, each checked). Rough cut with timecodes and the spoken phrase: `rough-dry-take-2026-11-08-v2.mp4` (live footage despite the name).
- Re-run: `video/README.md` (record, vo-words, rough, sync-sheet, render). Banding: none at 8x contrast on the dark cards.
- Not mine, for the product: the approval card's summary says "Your approval request for golden-gate-noodle" (the customer's slug, not its name); it is on screen in scene 5.
- Live take frames (`video/out/take-2026-11-08T16-54-51-215Z/frames/`) kept until the human accepts the final; README says delete them after.

## Captions, cards, voice clean-up, pad, naïve card (2026-11-08, same render)
Answers 09:35, 09:37, 09:46, 10:03. No new take, no dial, no new voice.
- Captions: the voiceover burned in from the Whisper word times, sentence chunks, at most 2 lines of 42 characters, same band and place as the call captions (#0B0F14 band, #E8EDF2 text). A caption moves to the top, or just above, when it would cover a boxed element or a card. Figures as on screen ($12,606, $18,000, 30%).
- Cards (same family as EmailCard): market during V1 ($572B count-up, then $5.7B to $17.2B, sources footer), business model in V8 after "actually comes back" (scene 9 holds 4.5 s so it never covers the fee box), "Runs on naïve" in the close after "That's Clawback." (close holds 3.5 s, blue accent, $2 in lime). Figures imported from `apps/dashboard/components/landing/market.ts`; its revenue range is $1.7B to $5.1B (1.716 to 5.148), not the $5.2B in the answer, so the card shows $5.1B.
- Voice: `video/record/audio-prep.ts` writes cleaned copies to `video/public/vo/clean/` (originals untouched). The gap noise was 80-300 Hz rumble. Chain: high-pass 80 Hz, afftdn from each clip's own longest gap (floor measured there), a gate keyed on the 300 Hz-3 kHz voice band (agate on the full band chattered on the wind), gentle 2:1 compression, and the lead-in/tail faded on the word times. Quiet windows fall 6-20 dB (p10 −63..−70 → −70..−92 dB). Speech is unchanged above 4 kHz, so no de-esser and no "underwater" sound. Before/after spectrograms of V9, V2 and V7: `~/Desktop/clawback-video/voice-before-after-2026-11-08.png`.
- Word timings: Whisper had squeezed each clip's opening phrase into the leading pause (V2's "This is Clawback" 1.3 s early, V7's "It cancels" 1.2 s). `vo-words.ts` now re-times the opening phrase from a second pass that starts at the speech onset. Text is unchanged, syncProblems is empty, and the 18-still sync sheet was re-checked on the final: `sync-sheet-2026-11-08-final.png`.
- Pad: generated by `audio-prep.ts` (Cmaj9, Am9, Fmaj9, G6sus, 8 s each, cross-faded sine partials, low-passed, a little room; ours, nothing downloaded). Level from `bedGainDb`: about 20 dB under speech in the final (pad alone −35.5 LUFS vs speech −16), 6 dB lower under the voice, 20 dB lower under the call, 2 s fade in, 3 s fade out on the close.
- Final mix: two-pass linear loudnorm, −16.0 LUFS, peak −1.5 dBFS. Edit 2:06.2 (3,782 frames, cap 3,900).
- Checks: vitest 13 (video), eslint and tsc pass; stills of each card and caption change checked. Levels and spectrograms at 0:05, the call and the close checked (measured, not listened to by ear).

## Caption band fix (answer 10:27, re-render only)
- Accepted; $5.1B and the pad level kept.
- Every caption (voiceover and call, one `CaptionBand`) is now one solid rounded block: #0B0F14 at 88%, a hairline #263040 edge and a soft shadow, 14/26 px padding. Before, the band sat on an inline span and left gaps between lines where the landing text showed through.
- placeCaption: when neither bottom nor top is clear, it now scans upward for the first place clear of every box during the cue (it had covered the Fremont box at 0:46), else the least-covering place.
- Stills checked at 0:05, 0:09, 0:46 and at all 21 caption changes (`~/Desktop/clawback-video/caption-sheet-2026-11-08.png`); sync sheet still clean. Final: `~/Desktop/clawback-video/demo-final.mp4`, 2:06.2, −16.0 LUFS, peak −1.5 dBFS. The ProRes master on the Desktop is from the previous render (not asked for this round).

## Known limits
- Orchestrator decision (2026-11-08, review round 1): fix the one finding by extracting the caption placement into a pure function with tests (multiple obstacles, moving highlight, upward scan, least-overlap fallback, the Fremont case). Behaviour must not change: do not re-render or touch ~/Desktop/clawback-video or Drive. This is the last fix round; later non-regression findings go here as known limits and the lane ships.

## Fix round (review round 1)
- Blocking: "Caption collision logic lacks regression tests" (video/src/Demo.tsx:34). Moved `overlaps`, `bandBox`, `placeCaption`, `CAPTION` and `CaptionPlace` verbatim from Demo.tsx/effects.tsx into the pure `video/src/timeline.ts` (effects.tsx and Demo.tsx import them). No logic change and no re-render. Added `video/src/caption-place.test.ts`: no obstacles, bottom blocked to top, several obstacles with upward scan to the lowest clear place (and 8 px lower is not clear), a moving highlight sampled across the cue, the Fremont case (top taken, the zoomed box on the bottom band), and the least-overlap fallback. Video vitest 19 pass, tsc and eslint clean.
- Known limit: the Fremont test uses a representative zoomed box, not the camera's exact on-screen rect at 0:46.
