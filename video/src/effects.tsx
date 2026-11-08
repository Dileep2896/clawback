import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/source-serif-4/600.css";
import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { REVENUE_BILLIONS, SPEND_TOTAL, WRONG_BILLIONS } from "../../apps/dashboard/components/landing/market.ts";
import { type Box, CAPTION, type CaptionPlace } from "./timeline.ts";

// The dashboard's dark theme (apps/dashboard/app/globals.css).
export const C = { paper: "#0b0f14", sheet: "#141a21", line: "#263040", ink: "#e8edf2", faded: "#8a96a6", money: "#c6f432", agent: "#3ba7ff", warn: "#ffb547" };
export const SANS = '"Atkinson Hyperlegible Next", system-ui, sans-serif';
export const SERIF = '"Source Serif 4", Georgia, serif';

const MAX_ZOOM = 1.6;
/** One camera move: to `box` from `frame` on, so it fills about half the frame (1x to MAX_ZOOM), unless `scale` is given. */
export type Shot = { frame: number; box: Box; scale?: number };

/** The camera at a frame: scale and translate (CSS order: scale then translate, about the centre). Pure, so captions can use it. */
export function cameraAt(frame: number, shots: Shot[], fps: number, width: number, height: number) {
  let cur = { cx: width / 2, cy: height / 2, s: 1 };
  for (const shot of shots) {
    if (frame < shot.frame) break;
    const k = spring({ frame: frame - shot.frame, fps, config: { damping: 200 }, durationInFrames: 24 });
    const s = shot.scale ?? Math.min(MAX_ZOOM, Math.max(1, Math.min((width * 0.55) / shot.box.w, (height * 0.55) / shot.box.h)));
    const to = { cx: shot.box.x + shot.box.w / 2, cy: shot.box.y + shot.box.h / 2, s };
    cur = { cx: cur.cx + (to.cx - cur.cx) * k, cy: cur.cy + (to.cy - cur.cy) * k, s: cur.s + (to.s - cur.s) * k };
  }
  const limX = (width * (cur.s - 1)) / (2 * cur.s);
  const limY = (height * (cur.s - 1)) / (2 * cur.s);
  return { s: cur.s, tx: Math.max(-limX, Math.min(limX, width / 2 - cur.cx)), ty: Math.max(-limY, Math.min(limY, height / 2 - cur.cy)) };
}

/** Where a footage box lands on screen under the camera. */
export function onScreen(b: Box, cam: { s: number; tx: number; ty: number }, width: number, height: number): Box {
  const x = width / 2 + cam.s * (b.x + cam.tx - width / 2);
  const y = height / 2 + cam.s * (b.y + cam.ty - height / 2);
  return { x, y, w: b.w * cam.s, h: b.h * cam.s };
}

/** Springs from one named element to the next, in footage coordinates. Clamped so the footage never shows an edge. */
export function Camera({ shots, children }: { shots: Shot[]; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { s, tx, ty } = cameraAt(frame, shots, fps, width, height);
  return <AbsoluteFill style={{ transform: `scale(${s}) translate(${tx}px, ${ty}px)`, transformOrigin: "50% 50%" }}>{children}</AbsoluteFill>;
}

/** A box on each thing the voice names, faded in over the lead before its word (6 frames) and out after its phrase. */
export function Boxes({ items }: { items: { from: number; to: number; boxes: Box[] }[] }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {items.flatMap((item, i) => {
        const o = interpolate(frame, [item.from, item.from + 6, item.to, item.to + 6], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        if (o <= 0) return [];
        // Rows stacked edge to edge (the seven lines) get no vertical padding, so their boxes do not overlap.
        const pad = item.boxes.length > 1 ? 1 : 6;
        return item.boxes.map((b, j) => (
          <div key={`${i}-${j}`} style={{ position: "absolute", left: b.x - 8, top: b.y - pad, width: b.w + 16, height: b.h + pad * 2, borderRadius: 12, border: `3px solid ${C.money}`, boxShadow: "0 0 0 4px rgb(11 15 20 / 0.4)", opacity: o, transform: `scale(${0.96 + 0.04 * o})` }} />
        ));
      })}
    </AbsoluteFill>
  );
}

/** A drawn arrow that glides to each click and rings on it. Playwright clicks leave no real cursor in the footage. */
export function Cursor({ clicks }: { clicks: { frame: number; x: number; y: number }[] }) {
  const frame = useCurrentFrame();
  if (!clicks.length) return null;
  const MOVE = 18;
  const next = clicks.findIndex((c) => c.frame >= frame);
  const to = clicks[next === -1 ? clicks.length - 1 : next];
  const from = next > 0 ? clicks[next - 1] : { frame: to.frame - MOVE, x: to.x + 260, y: to.y + 180 };
  const p = next === -1 ? 1 : interpolate(frame, [Math.max(from.frame, to.frame - MOVE), to.frame], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) });
  const x = from.x + (to.x - from.x) * p;
  const y = from.y + (to.y - from.y) * p;
  // Only there around the clicks: fades in before the first glide, out a second after the last click.
  const first = clicks[0].frame - MOVE;
  const last = clicks[clicks.length - 1].frame;
  const opacity = interpolate(frame, [first - 30, first - 20, last + 25, last + 35], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      {clicks.map((c) => {
        const age = frame - c.frame;
        if (age < 0 || age > 16) return null;
        return <div key={c.frame} style={{ position: "absolute", left: c.x - 28, top: c.y - 28, width: 56, height: 56, borderRadius: 999, border: `3px solid ${C.money}`, opacity: 1 - age / 16, transform: `scale(${0.4 + age / 16})` }} />;
      })}
      <svg width="34" height="40" viewBox="0 0 17 20" style={{ position: "absolute", left: x - 3, top: y - 2, filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.5))" }}>
        <path d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.6 11.6 L13 11.6 Z" fill={C.ink} stroke={C.paper} strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </AbsoluteFill>
  );
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A count-up laid over the figure, which fades to reveal the page's own number. Its box is drawn by Boxes. */
export function Callout({ box, start, cents }: { box?: Box; start: number; cents: number }) {
  const frame = useCurrentFrame();
  if (!box) return null;
  const f = frame - start;
  const count = interpolate(f, [0, 45], [0, cents], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const cover = interpolate(f, [-1, 0, 50, 62], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8, background: C.sheet, opacity: cover, fontFamily: SERIF, fontWeight: 600, fontSize: box.h * 0.82, lineHeight: `${box.h + 8}px`, color: C.ink, fontVariantNumeric: "lining-nums tabular-nums", whiteSpace: "nowrap" }}>
        {usd(Math.round(count))}
      </div>
    </AbsoluteFill>
  );
}

/** A small label in the corner: speed-ups, cuts and "real call" notes, so nothing on screen pretends. */
export function Chip({ children, at = "top-right" }: { children: ReactNode; at?: "top-right" | "bottom-left" }) {
  const pos = at === "top-right" ? { top: 28, right: 28 } : { bottom: 36, left: 36 };
  return (
    <div style={{ position: "absolute", ...pos, padding: "8px 16px", borderRadius: 999, background: "rgb(11 15 20 / 0.86)", border: `1px solid ${C.line}`, color: C.ink, fontFamily: SANS, fontSize: 26, fontWeight: 700 }}>
      {children}
    </div>
  );
}

export type Utterance = { role: string; words: { word: string; start: number; end: number }[] };

// Captions, voice and call alike: one band, bottom centre, unless it would cover a box (then `place` moves it).
function CaptionBand({ place = { bottom: CAPTION.bottom }, children }: { place?: CaptionPlace; children: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: 160, right: 160, ...place, textAlign: "center", fontFamily: SANS, fontSize: CAPTION.fontSize, lineHeight: CAPTION.lineHeight, color: C.ink }}>
      {/* One solid rounded band behind all its lines, so busy footage never shows between them. */}
      <span style={{ display: "inline-block", padding: `${CAPTION.padY}px ${CAPTION.padX}px`, background: "rgb(11 15 20 / 0.88)", borderRadius: 14, border: `1px solid ${C.line}`, boxShadow: "0 10px 34px rgb(0 0 0 / 0.55)" }}>{children}</span>
    </div>
  );
}

/** The call's own words, timed by Retell, while its recording plays (a live call's panel shows no transcript until it ends). */
export function CallCaptions({ transcript, fromSec }: { transcript: Utterance[]; fromSec: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = fromSec + frame / fps;
  const u = transcript.find((x) => x.words.length && x.words[0].start <= t && t <= x.words[x.words.length - 1].end + 0.8);
  if (!u) return null;
  return (
    <CaptionBand>
      <b style={{ color: u.role === "agent" ? C.agent : C.warn }}>{u.role === "agent" ? "Clawback" : "Provider"}: </b>
      {u.words.filter((w) => w.start <= t).map((w) => w.word).join("")}
    </CaptionBand>
  );
}

/** The voiceover's words, one sentence chunk at a time (two lines at most), each in its own place. */
export function VoCaptions({ cues }: { cues: { from: number; to: number; lines: string[]; place: CaptionPlace }[] }) {
  const frame = useCurrentFrame();
  const cue = cues.find((c) => frame >= c.from && frame < c.to);
  if (!cue) return null;
  return (
    <CaptionBand place={cue.place}>
      {cue.lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {line}
        </span>
      ))}
    </CaptionBand>
  );
}

/** Light moving grain, against banding in the big dark fills. */
export function Grain({ opacity = 0.035 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={Math.floor(random(frame) * 1000)} />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
}

export function TitleCard({ kind }: { kind: "title" | "close" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center", fontFamily: SANS, color: C.ink }}>
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 24}px)`, textAlign: "center" }}>
        <div style={{ fontSize: 148, fontWeight: 700, letterSpacing: "-0.03em" }}>
          Claw<span style={{ color: C.money }}>back</span>
        </div>
        <div style={{ marginTop: 18, fontSize: 48, color: C.faded }}>
          {kind === "title" ? (
            <>
              Your bills are wrong. <span style={{ color: C.ink }}>Agents fix them.</span>
            </>
          ) : (
            "One approval. Everything else ran on its own."
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** "We also use email" as a motion note over the footage: in with an ease-out, held, out. Says nothing about this take's path. */
export function EmailCard({ start, holdSec = 3 }: { start: number; holdSec?: number }) {
  const { fps } = useVideoConfig();
  const f = useCurrentFrame() - start;
  const inF = Math.round(0.4 * fps);
  const end = inF + Math.round(holdSec * fps);
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) } as const;
  const show = f < end ? interpolate(f, [0, inF], [0, 1], ease) : interpolate(f, [end, end + inF], [1, 0], ease);
  if (f < 0 || show <= 0) return null;
  return (
    <div style={{ position: "absolute", top: 660, left: "50%", transform: `translate(-50%, ${(1 - show) * 24}px)`, opacity: show, display: "flex", alignItems: "center", gap: 20, padding: "22px 34px", borderRadius: 18, background: "rgb(20 26 33 / 0.94)", border: `1px solid ${C.line}`, boxShadow: "0 18px 50px rgb(0 0 0 / 0.45)", fontFamily: SANS, fontSize: 40, color: C.ink, whiteSpace: "nowrap" }}>
      <svg width="46" height="34" viewBox="0 0 46 34" aria-hidden="true">
        <rect x="2" y="2" width="42" height="30" rx="4" fill="none" stroke={C.agent} strokeWidth="3" />
        <path d="M3 4 L23 19 L43 4" fill="none" stroke={C.agent} strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <span>
        <b style={{ color: C.agent }}>Prefer email?</b> Clawback can email the provider instead.
      </span>
    </div>
  );
}

// The market figures, straight from the landing's own source (apps/dashboard/components/landing/market.ts): never typed here.
const billions = (n: number) => `$${n.toFixed(1)}B`;
const MARKET = {
  spend: SPEND_TOTAL,
  wrong: `${billions(WRONG_BILLIONS[0])} to ${billions(WRONG_BILLIONS[1])}`,
  revenue: `${billions(REVENUE_BILLIONS[0])} to ${billions(REVENUE_BILLIONS[1])}`,
};
/** Where each card sits, in screen pixels, so captions can keep clear of it. */
export const CARD_RECT = { market: { x: 410, y: 150, w: 1100, h: 500 }, model: { x: 330, y: 90, w: 1260, h: 250 }, naive: { x: 310, y: 740, w: 1300, h: 250 } } as const;

/** In with an ease-out over 0.4 s, out over 0.4 s before `end` (scene frames). */
function useCardIn(start: number, end: number) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const f = frame - start;
  const inF = Math.round(0.4 * fps);
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) } as const;
  const show = f < 0 ? 0 : Math.min(interpolate(f, [0, inF], [0, 1], ease), interpolate(frame, [end - inF, end], [1, 0], ease));
  return { f, show };
}
const cardStyle = (rect: { x: number; y: number; w: number; h: number }, show: number) =>
  ({
    position: "absolute",
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    boxSizing: "border-box",
    opacity: show,
    transform: `translateY(${(1 - show) * 24}px)`,
    borderRadius: 18,
    background: "rgb(20 26 33 / 0.94)",
    border: `1px solid ${C.line}`,
    boxShadow: "0 18px 50px rgb(0 0 0 / 0.45)",
    fontFamily: SANS,
    color: C.ink,
  }) as const;

/** The market, as the voice says "billions a year": what US businesses spend, then what is billed wrong. */
export function MarketCard({ start, step, end }: { start: number; step: number; end: number }) {
  const frame = useCurrentFrame();
  const { show, f } = useCardIn(start, end);
  if (show <= 0) return null;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) } as const;
  const second = interpolate(frame - step, [0, 12], [0, 1], clamp);
  const spend = Math.round(interpolate(f, [0, 30], [0, MARKET.spend], clamp));
  return (
    <div style={{ ...cardStyle(CARD_RECT.market, show), padding: "40px 56px", display: "grid", alignContent: "center", gap: 26, textAlign: "center" }}>
      <div>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 120, lineHeight: 1.05, color: C.money, fontVariantNumeric: "lining-nums tabular-nums" }}>${spend}B</div>
        <div style={{ fontSize: 36, marginTop: 6 }}>US businesses pay a year for electricity, gas and phone</div>
      </div>
      <div style={{ opacity: second, transform: `translateY(${(1 - second) * 16}px)` }}>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 80, lineHeight: 1.05, color: C.money }}>{MARKET.wrong}</div>
        <div style={{ fontSize: 34, marginTop: 6 }}>billed wrong or on the wrong plan (1 to 3%)</div>
      </div>
      <div style={{ fontSize: 22, color: C.faded }}>Estimates. US EIA 2025, Grand View Research 2023.</div>
    </div>
  );
}

/** The business model, after "only of money that actually comes back". */
export function ModelCard({ start, end }: { start: number; end: number }) {
  const { show } = useCardIn(start, end);
  if (show <= 0) return null;
  return (
    <div style={{ ...cardStyle(CARD_RECT.model, show), padding: "30px 48px", display: "grid", alignContent: "center", gap: 18, textAlign: "center" }}>
      <div style={{ fontSize: 40, fontWeight: 700 }}>
        <span style={{ color: C.money }}>30%</span> of what we recover. Nothing up front, nothing if nothing comes back.
      </div>
      <div style={{ fontSize: 34 }}>
        Up to <span style={{ color: C.money, fontWeight: 700 }}>{MARKET.revenue}</span> a year at 30% <span style={{ fontSize: 24, color: C.faded }}>ceiling, not a forecast</span>
      </div>
    </div>
  );
}

/** In the close, under the Clawback card: what the product runs on. Says nothing about the call in this video. */
export function NaiveCard({ start, end }: { start: number; end: number }) {
  const { show } = useCardIn(start, end);
  if (show <= 0) return null;
  return (
    <div style={{ ...cardStyle(CARD_RECT.naive, show), borderColor: C.agent, padding: "28px 48px", display: "grid", alignContent: "center", gap: 14, textAlign: "center" }}>
      <div style={{ fontSize: 52, fontWeight: 700, color: C.agent }}>Runs on naïve</div>
      <div style={{ fontSize: 34 }}>Nine agents as one naïve team. Every action gated and audited, <span style={{ color: C.money }}>$2</span> cap a run.</div>
      <div style={{ fontSize: 26, color: C.faded }}>Try it: the judge sandbox is a naïve App.</div>
    </div>
  );
}

