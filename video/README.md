# Demo video

The 2:00 hackathon video: one real run, captured with CDP screencast, edited in Remotion 4.0.528 under the human's voiceover. Research: `docs/plan/demo-video.md`. Not part of the pnpm workspace: it has its own `pnpm-workspace.yaml` and lockfile, so run `pnpm install` from this folder (`--ignore-workspace` would skip its `allowBuilds` and refuse esbuild).

Footage, voice and renders are gitignored: `out/`, `public/footage/`, `public/vo/`, `public/call.*`. `public/events.json` (the take's event log) and `public/scenes.json` (the edit) are committed.

## Record (from the repo root)

1. Own database and ports in this worktree's `.env` (`DATABASE_URL` → `clawback_video`, dashboard 3010, portal 3011, `WEBHOOK_PORT=3012`, `WEBHOOK_URL`). A fresh take needs no sign-ups in that database: recreate it (`CREATE DATABASE`, `pnpm db:migrate`, `pnpm seed`, `pnpm seed:portal`) rather than `pnpm demo:reset`, which also empties the shared Mailpit inbox.
2. Start `next dev --port 3010 -H 127.0.0.1` (dashboard), `next dev --port 3011` (portal) and `pnpm dev:webhooks`, all with the same `VOICE_MODE`.
3. `pnpm exec tsx --env-file-if-exists=.env video/record/record-demo.ts` (sim) or `VOICE_MODE=live … --live` (one real call, only with the orchestrator's go). Each run writes a new `video/out/take-<time>/` (its path is the first log line) with `frames/`, `frames.ffconcat` and `events.json`, never touching earlier takes or renders, and fails the take on a REPLAY banner, speech-unavailable text or wrong figures.
4. `TAKE=video/out/take-<time>` (the take to use), `cp $TAKE/events.json video/public/events.json`, then step 6 for the footage. A `--live` take also fails unless every call on it is a finished live call with a recording and no sim fallback.
5. Call audio: `pnpm exec tsx --env-file=.env video/record/call-audio.ts <retell call id>` (read-only GETs, free; the id is in the webhook log line `Live call <id>: …`) writes `video/public/call.wav` and the word-timed `call.transcript.json` the captions use. Hand-fix misheard names there (the 2026-11-07 take: "Basal"/"Baytel" → "BayTel"). `cli.ts readback <id>` gives the Retell and Vapi cost.
6. Capture master (the ProRes HQ master is made only of the final edit, for disk), with `$TAKE` from step 4: `ffmpeg -f concat -safe 0 -i $TAKE/frames.ffconcat -vf fps=60,format=yuv420p -c:v libx264 -crf 12 $TAKE/footage-master.mp4`, then `mkdir -p video/public/footage && ln -f $TAKE/footage-master.mp4 video/public/footage/footage.mp4`. Delete `$TAKE/frames/` after the final render.

## Edit and render (from `video/`)

- Voiceover clips: copy `~/Desktop/clawback-voiceover/Clawback/V*.m4a` to `public/vo/` (never edit the originals). Scene lengths in `public/scenes.json` are the clip lengths (ffprobe) plus a 0.5 s breath.
- Word timings (once per set of clips, free and local): download `ggml-small.en.bin` from huggingface.co/ggerganov/whisper.cpp into `out/models/`, then from the repo root `pnpm exec tsx video/record/vo-words.ts` writes `src/vo-words.json` (whisper.cpp, misheard words set to the script's; each clip's opening phrase is re-timed by a second pass from the speech onset, since Whisper squeezes it into the leading pause).
- Audio (after the word timings): `pnpm exec tsx video/record/audio-prep.ts` writes the cleaned voice `public/vo/clean/V*.wav` (high-pass 80 Hz, afftdn from each clip's own gap, a gate keyed on the voice band, gentle compression, the lead-in and tail faded) and `public/vo/bed.wav`, a pad generated from sine partials (ours, nothing licensed or downloaded). `bedGainDb` in `src/timeline.ts` sets its level: about 20 dB under speech in the final mix, 6 dB lower under the voice, 20 dB lower under the call, 2 s fade in, 3 s out.
- Highlights: each scene's `highlights` in `public/scenes.json` names a phrase the voice says (`say`, held to the end of `to`) and the logged element to box. The box shows 0.2 s before the word and the camera moves to that element. The recorder is paced by the same word times, so every named element is on screen and logged before its word. `footage.atWord` plays an event on a word (the Approve click on "tap").
- Sync proof: after `pnpm rough`, from the repo root `pnpm exec tsx video/record/sync-sheet.ts video/out/rough.mp4 ~/Desktop/clawback-video/sync-sheet-<date>.png` prints any element boxed before the take showed it and tiles one still per highlight.
- `pnpm studio` to preview, `pnpm rough` for the rough cut with timecode and scene names, `pnpm render` (H.264 CRF 16) and `pnpm master` (ProRes HQ).
- Loudness: `ffmpeg -i out/demo.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 320k out/demo-final.mp4`.
- `src/timeline.test.ts` runs under the root `pnpm test`.
