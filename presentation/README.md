# Clawback stage deck

A 4-minute deck in plain HTML, CSS and JS. No build step, no network: open `index.html` by double-click (file://) in Chrome.

## Keys

| Key | Does |
|---|---|
| → Space PageDown Enter ↓ | next build step (clickers send PageDown) |
| ← PageUp ↑ | back one step |
| Home / End | first / last step |
| number then Enter | jump to that slide |
| F | fullscreen |
| B or . | black screen (again to return) |
| S | presenter window: notes for this step, the next step, a timer against 4:00 (R resets it) |

The URL keeps the place (`#3.2` = slide 3, step 2), so a reload resumes. Steps and notes are listed in `notes.md`.

## Files

- `index.html`, `deck.css`, `deck.js`: the deck. Figures come only from `apps/dashboard/components/landing/market.ts` and the recorded run of 2026-11-08.
- `notes.md`: the spoken script, one heading per build step (about 540 words, 3:50 at 140 words a minute, plus the 22 s call excerpt).
- `fonts/`: Atkinson Hyperlegible Next and Source Serif 4, SIL Open Font License (licences beside them).
- `make-clips.sh`: cuts the raw platform recording (`~/Desktop/clawback-video/raw-take-2026-11-08/`) into `media/*.mp4` (trim and scale only) and writes `notes.js` from `notes.md`. `--install` also copies the deck to `~/Desktop/clawback-presentation/`. Needs ffmpeg.
- `shots.cjs`: steps through the deck in Chromium at 1920×1080 and saves one screenshot per step to `steps/` in the installed folder.

## Rebuild

```sh
./presentation/make-clips.sh --install
NODE_PATH=node_modules node presentation/shots.cjs
```

`media/` is not committed; run `make-clips.sh` after a fresh checkout.
