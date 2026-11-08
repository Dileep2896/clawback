# Clawback demo video: record and edit research

## What the repo already gives us

- `scripts/rehearse-stage.ts` drives Chromium through Playwright at 1920×1080. It covers sign-up, the bill upload, log out and back in, Approve, `/agents` and the Overview. It prints step times and asserts the three figures through test ids (`overview-refund`, `overview-savings`, `overview-fee`, `overview-keeps`, `overview-approval`, `overview-approve`). It has no exports, so copy its `signUp`/`type`/`think` helpers (about 40 lines). Don't import it.
- `pnpm demo:replay --speed N` (`scripts/replay.ts`) plays `data/replay/run.jsonl` into local Postgres. It needs no model, no voice and no network. At 1× it runs 4:27 with a 1:39 call; at 2× it runs 2:14 (`docs/plan/rehearsal-notes.md`). It runs `demo:reset` first, which deletes Linda's sign-up. Sign her up after the reset and keep that browser open.
- Under replay, Approve is hidden and its route returns 409; the recording's approval came by SMS. So the video can't show an Approve click during replay. Use the Overview ending "Approved by Linda Park, by SMS" instead. The `replay-banner` (`components/header.tsx`) is on every page. Keep it in frame or put a "Recorded replay" lower-third on screen.
- The call audio in replay is browser `speechSynthesis` (`components/panels/call.tsx`), voice "Samantha", with pitch 1 for the agent and 0.7 for the provider. If speech fails, the page shows "Browser speech unavailable. Transcript only." Check that this line never appears in the footage.
- Fonts are Atkinson Hyperlegible Next and Source Serif 4 from `@fontsource` (`app/globals.css`).
- To check: the sample-bill upload calls the webhook `/parse-upload` (`app/api/bills/upload/route.ts`). Confirm it hits the parse cache, so it costs nothing, or start the recording at the Overview/`/agents` with sign-up pre-done.

## 1. Recording options

| Option | Quality / fps | Fit |
|---|---|---|
| Playwright `recordVideo` | Defaults to the viewport scaled to fit 800×800 unless `size` is set ([playwright.dev/docs/videos](https://playwright.dev/docs/videos)). WebM/VP8 at a fixed low frame rate (about 25 fps, a Playwright implementation detail, not in the docs). Visibly soft. | QA artefact only. No. |
| CDP `Page.startScreencast` | Sends JPEG/PNG frames with `quality`, `maxWidth/Height` and `everyNthFrame`; each `screencastFrame` carries a timestamp. Frames come only when the page repaints (variable rate) and each must be acked. Marked experimental ([CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/)). | Frames match the viewport exactly, at `deviceScaleFactor: 2` → 3840×2160. Works headless, needs no screen-recording permission, and a box maps to video pixels by ×2 with no offsets. |
| Playwright drives headed Chrome + `ffmpeg -f avfoundation -framerate 60 -capture_cursor 0` ([ffmpeg avfoundation](https://ffmpeg.org/ffmpeg-devices.html#avfoundation)) | True constant 60 fps at physical Retina pixels. | Smoothest. You must crop the window and map offsets, it needs a display that fits a 1920×1080 CSS window, plus the macOS screen-recording permission. System audio needs a loopback device such as BlackHole. |
| Screen Studio ([screen.studio](https://screen.studio)) | Good automatic zoom-on-click and cursor smoothing. | Manual, paid. You can't drive its zooms from our event log. Fallback only. |

**Recommendation:** use CDP screencast from a new `video/record/record-demo.ts`, a Playwright copy of the rehearse flow:

- `chromium.launch({ args: ["--mute-audio"] })`, context `{ viewport: 1920×1080, deviceScaleFactor: 2 }`.
- `cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: 3840, maxHeight: 2160 })`. Write each frame with its `metadata.timestamp` and ack it.
- After the run, ffmpeg builds a constant-frame-rate file from those timestamps (concat demuxer with `duration` lines) as ProRes 422 HQ or H.264 at CRF 12, 60 fps.
- If the frame pacing looks steppy in fast scenes, switch only the capture to avfoundation; the event log stays the same.

Playwright clicks never move the OS cursor, so the footage has no cursor. Draw a synthetic cursor in Remotion from the logged click points. This is cleaner than a real cursor and gives cursor-follow for free.

**Call audio:** `--mute-audio` silences the tab. On macOS, Chrome's speech is likely spoken by the OS and not routed through the tab, so it may bypass the flag and tab capture. I haven't verified this. Either way, don't record it. Rebuild it offline for free: log every new `[data-call-row="speech"]` (text, role, t) with a MutationObserver. Then run `say -v Samantha -o line-N.aiff "<text>"` per line, with a lower-pitch voice for the provider. Place each clip at its logged t in Remotion.

**Event log (`events.json`):** `{ t: ms since first frame, kind, label, box: {x,y,w,h} in CSS px, dpr: 2 }`.
- Log `click`, `type-start/end`, `navigate`, `figure-visible` (wait on `overview-refund`, then `boundingBox()`), `approval-visible`, `call-line` and `run-success`.
- Use `Date.now()` minus the wall time of the first screencast frame. Frame timestamps are seconds since epoch, so both use one clock.

## 2. Remotion approach

Based on the installed Remotion skills (v4.0.528): `remotion-best-practices`, `remotion-markup/embedding-videos.md`, `audio.md`, `local-fonts.md` and `remotion-captions/*`.

- **Footage:** `<Video>` from `@remotion/media`, which the skills now prefer, with `trimBefore/trimAfter` and `playbackRate` per scene. `<OffthreadVideo>` from `remotion` is the frame-exact fallback ([docs/offthreadvideo](https://www.remotion.dev/docs/offthreadvideo), [docs/media/video](https://www.remotion.dev/docs/media/video)).
- **Scenes:** one `<Series.Sequence>` per scene ([docs/series](https://www.remotion.dev/docs/series)), with `durationInFrames` taken from a `scenes.json` that you edit after the voiceover.
- **Zoom:** `spring()` or `interpolate(..., { easing: Easing.bezier(0.65,0,0.35,1) })` on `scale`, with a translate toward the logged box centre. Clamp so no edge shows ([docs/interpolate](https://www.remotion.dev/docs/interpolate), [docs/spring](https://www.remotion.dev/docs/spring)). Recording at 2× DPR means zooms up to 2× stay sharp at 1080p.
- **Audio:** the voiceover as one `<Audio>`, the `say` call clips as more `<Audio>` layers with `volume` ducked under the voiceover.
- **Captions:** run `@remotion/install-whisper-cpp` `transcribe({ tokenLevelTimestamps: true })` on the voiceover (16 kHz WAV), then `toCaptions`. Display them with `@remotion/captions` `createTikTokStyleCaptions` ([docs/install-whisper-cpp](https://www.remotion.dev/docs/install-whisper-cpp)). Hand-fix "Clawback", "BayCurrent" and the dollar figures in the JSON.
- **Callouts:** for "$12,606.06", draw a ring plus a counter (`interpolate` 0 → 12606.06, formatted in Source Serif 4) placed from the `figure-visible` box.

```tsx
// video/src/ZoomTo.tsx
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
type Box = { x: number; y: number; w: number; h: number };
type Ev = { t: number; kind: string; box?: Box };

export const ZoomTo: React.FC<{ events: Ev[]; kind: string; zoom?: number; holdMs?: number; offsetMs: number; children: React.ReactNode }> =
  ({ events, kind, zoom = 1.8, holdMs = 2500, offsetMs, children }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig(); // 1920x1080; footage CSS px == comp px
  const ev = events.find((e) => e.kind === kind && e.box);
  if (!ev?.box) return <AbsoluteFill>{children}</AbsoluteFill>;
  const start = Math.round(((ev.t - offsetMs) / 1000) * fps) - 10; // lead the action by 1/3 s at 30 fps
  const end = start + Math.round((holdMs / 1000) * fps);
  const zin = spring({ frame: frame - start, fps, config: { damping: 200 } });
  const zout = spring({ frame: frame - end, fps, config: { damping: 200 } });
  const s = interpolate(zin - zout, [0, 1], [1, zoom]);
  const cx = ev.box.x + ev.box.w / 2, cy = ev.box.y + ev.box.h / 2;
  // Clamp so the scaled frame never shows an edge.
  const tx = Math.max(Math.min(width / 2 - cx, (width * (s - 1)) / (2 * s)), (-width * (s - 1)) / (2 * s));
  const ty = Math.max(Math.min(height / 2 - cy, (height * (s - 1)) / (2 * s)), (-height * (s - 1)) / (2 * s));
  const k = (s - 1) / (zoom - 1 || 1);
  return (
    <AbsoluteFill style={{ transform: `scale(${s}) translate(${tx * k}px, ${ty * k}px)`, transformOrigin: "50% 50%" }}>
      {children}
    </AbsoluteFill>
  );
};
// <ZoomTo events={events} kind="figure-visible" offsetMs={scene.trimStartMs}><Video src={staticFile("footage.mov")} trimBefore={...} /></ZoomTo>
```

**Render:** `npx remotion render Demo out/demo.mp4 --codec h264 --crf 16 --x264-preset slow` for upload. For a master, use `--codec prores --prores-profile hq`. 1080p30 is enough for UI. Use 60 only if the source is 60 and the zooms look steppy ([docs/cli/render](https://www.remotion.dev/docs/cli/render)).

## 3. Where it lives, versions

- Put it in `video/` at the repo root. `pnpm-workspace.yaml` lists only `apps/*`, `services/*` and `packages/*`, so `video/` isn't a workspace package and doesn't ship. Install with `pnpm install --ignore-workspace` inside `video/` so it keeps its own lockfile.
- gitignore `video/public/footage/`, `video/out/` and `video/whisper.cpp/`.
- Layout: `video/record/record-demo.ts`, `video/src/{Root,Demo,ZoomTo,Cursor,Callout,Captions}.tsx`, `video/public/{events.json,scenes.json,voiceover.wav,captions.json,call/*.aiff}`.
- Pin every Remotion package to the same exact version, `4.0.528`, the version the installed skills target (Remotion requires matching versions): `remotion @remotion/cli @remotion/media @remotion/captions @remotion/install-whisper-cpp @remotion/fonts`.
- Also React 19 as in the dashboard, Playwright `1.65.x` as in the root, whisper.cpp `1.5.5` with `medium.en` as in the skill, and ffmpeg 7.1 (installed).

## 4. Pipeline and effort

1. **Prep (0.5 h):** `pnpm demo:reset`, `pnpm dev:dashboard`, sign up Linda, run the dark theme if wanted, and confirm the upload parse is cached.
2. **Record (2–3 h incl. script):** `record-demo.ts` runs landing → sample sign-up and upload → `/agents` while it spawns `pnpm demo:replay --speed 1` → Overview → Money. It writes `frames/`, `events.json` and `call-lines.json`. Do two takes and keep the cleaner one.
3. **Assemble (0.5 h):** ffmpeg frames → `footage.mov` (CFR 60, ProRes). Generate the `say` call clips.
4. **Rough cut (3–4 h):** `scenes.json` holds about 6 scenes (hook/title 8 s, problem 12 s, sign-up and upload 15 s, agents board and call 45 s at `playbackRate` 2–3 with call excerpts, the $12,606.06 reveal 15 s, close 10 s), about 1:50. Add ZoomTo, Cursor, Callout and titles. Render a silent preview with a burned-in timecode.
5. **Voiceover (human, 1 h):** read to the silent preview in one take, export `voiceover.wav`.
6. **Re-time (1–2 h):** move scene boundaries in `scenes.json` to the voiceover's pauses. Remotion's silence-detection skill (`remotion-markup/silence-detection.md`) or the Whisper word timestamps give you the cut points.
7. **Captions (1 h):** Whisper → `captions.json`, hand-fix, style.
8. **Render and check (1 h):** ProRes master plus an H.264 upload. Watch it on a phone and a TV.

Total is about 1.5–2 days of engineering plus about an hour of the human's voice time. No paid calls.

## 5. Pitfalls

- **Fonts:** load both `@fontsource` families through `@remotion/fonts` `loadFont` for titles and captions. Have the recorder wait for `document.fonts.ready` before the first frame.
- **Dark theme banding:** large flat dark areas band under H.264. Keep the master in ProRes, upload at CRF ≤16 with 10-bit if the platform accepts it (`--pixel-format yuv420p10le` with h265), and add a light 1–2% grain overlay on large dark fills.
- **Retina mapping:** boxes are CSS px. At DPR 2 the footage is 3840×2160. Size `<Video>` to 1920×1080 and the boxes map 1:1. Don't mix DPR between takes.
- **Animation speed:** speeding replay changes speech rate, and above 2× the panel says speech is off. Record at 1× and speed up in Remotion with `playbackRate`; CSS transitions sped 3× look jittery, so cut instead. Turn off `prefers-reduced-motion` emulation.
- **Replay honesty:** keep the REPLAY banner visible, or add "Recorded replay of a real run" on screen whenever the board or call is shown. Never cover the banner with a zoom crop on `/agents`.
- **Speech-unavailable text:** headless can fail speech and print "Browser speech unavailable". Check for `speech-unavailable` in the recorder and fail the take.
- **2:00 cap:** set the composition at 3600 frames (30 fps) as a hard limit and run it through `calculateMetadata`. Aim for 1:50 for slack.
- **Clock drift:** rerun replay only after `demo:reset`; a second replay is refused.
