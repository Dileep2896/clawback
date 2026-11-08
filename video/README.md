# Demo video

The 2:00 hackathon video: one real run, captured with CDP screencast, edited in Remotion 4.0.528 under the human's voiceover. Research: `docs/plan/demo-video.md`. Not part of the pnpm workspace: it has its own `pnpm-workspace.yaml` and lockfile, so run `pnpm install` from this folder (`--ignore-workspace` would skip its `allowBuilds` and refuse esbuild).

Footage, voice and renders are gitignored: `out/`, `public/footage/`, `public/vo/`, `public/call.*`. `public/events.json` (the take's event log) and `public/scenes.json` (the edit) are committed.

## Record (from the repo root)

1. Own database and ports in this worktree's `.env` (`DATABASE_URL` → `clawback_video`, dashboard 3010, portal 3011, `WEBHOOK_PORT=3012`, `WEBHOOK_URL`). A fresh take needs no sign-ups in that database: recreate it (`CREATE DATABASE`, `pnpm db:migrate`, `pnpm seed`, `pnpm seed:portal`) rather than `pnpm demo:reset`, which also empties the shared Mailpit inbox.
2. Start `next dev --port 3010 -H 127.0.0.1` (dashboard), `next dev --port 3011` (portal) and `pnpm dev:webhooks`, all with the same `VOICE_MODE`.
3. `pnpm exec tsx --env-file-if-exists=.env video/record/record-demo.ts` (sim) or `VOICE_MODE=live … --live` (one real call, only with the orchestrator's go). It writes `video/out/frames/`, `frames.ffconcat` and `events.json`, and fails the take on a REPLAY banner, speech-unavailable text or wrong figures.
4. `cp video/out/events.json video/public/events.json`, then step 6 for the footage.
5. Call audio: `pnpm exec tsx --env-file=.env video/record/call-audio.ts <retell call id>` (read-only GETs, free; the id is in the webhook log line `Live call <id>: …`) writes `video/public/call.wav` and the word-timed `call.transcript.json` the captions use. Hand-fix misheard names there (the 2026-11-07 take: "Basal"/"Baytel" → "BayTel"). `cli.ts readback <id>` gives the Retell and Vapi cost.
6. Capture master (the ProRes HQ master is made only of the final edit, for disk): `ffmpeg -f concat -safe 0 -i frames.ffconcat -vf fps=60,format=yuv420p -c:v libx264 -crf 12 out/footage-master.mp4`, hard-linked as `public/footage/footage.mp4`. Delete `out/frames/` after the final render.

## Edit and render (from `video/`)

- Voiceover clips: copy `~/Desktop/clawback-voiceover/Clawback/V*.m4a` to `public/vo/` (never edit the originals). Scene lengths in `public/scenes.json` are the clip lengths (ffprobe) plus a 0.5 s breath.
- `pnpm studio` to preview, `pnpm rough` for the rough cut with timecode and scene names, `pnpm render` (H.264 CRF 16) and `pnpm master` (ProRes HQ).
- Loudness: `ffmpeg -i out/demo.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 320k out/demo-final.mp4`.
- `src/timeline.test.ts` runs under the root `pnpm test`.
