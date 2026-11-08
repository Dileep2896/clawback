import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/source-serif-4/600.css";
import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Box } from "./timeline.ts";

// The dashboard's dark theme (apps/dashboard/app/globals.css).
export const C = { paper: "#0b0f14", sheet: "#141a21", line: "#263040", ink: "#e8edf2", faded: "#8a96a6", money: "#c6f432", agent: "#3ba7ff", warn: "#ffb547" };
export const SANS = '"Atkinson Hyperlegible Next", system-ui, sans-serif';
export const SERIF = '"Source Serif 4", Georgia, serif';

/** Springs into a box from `start` (scene frames) and stays. Clamped so the footage never shows an edge. */
export function ZoomTo({ box, start, zoom = 1.8, children }: { box?: Box; start: number; zoom?: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (!box) return <AbsoluteFill>{children}</AbsoluteFill>;
  const k = spring({ frame: frame - start, fps, config: { damping: 200 }, durationInFrames: 40 });
  const s = interpolate(k, [0, 1], [1, zoom]);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const limX = (width * (s - 1)) / (2 * s);
  const limY = (height * (s - 1)) / (2 * s);
  const tx = Math.max(-limX, Math.min(limX, (width / 2 - cx) * k));
  const ty = Math.max(-limY, Math.min(limY, (height / 2 - cy) * k));
  return <AbsoluteFill style={{ transform: `scale(${s}) translate(${tx}px, ${ty}px)`, transformOrigin: "50% 50%" }}>{children}</AbsoluteFill>;
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
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
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

/** A ring round the figure and a count-up laid over it, which fades to reveal the page's own number. */
export function Callout({ box, start, cents }: { box?: Box; start: number; cents: number }) {
  const frame = useCurrentFrame();
  if (!box) return null;
  const f = frame - start;
  const count = interpolate(f, [0, 45], [0, cents], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const cover = interpolate(f, [-1, 0, 50, 62], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ring = interpolate(f, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8, background: C.sheet, opacity: cover, fontFamily: SERIF, fontWeight: 600, fontSize: box.h * 0.82, lineHeight: `${box.h + 8}px`, color: C.ink, fontVariantNumeric: "lining-nums tabular-nums", whiteSpace: "nowrap" }}>
        {usd(Math.round(count))}
      </div>
      <div style={{ position: "absolute", left: box.x - 18, top: box.y - 14, width: box.w + 36, height: box.h + 28, borderRadius: 14, border: `3px solid ${C.money}`, opacity: ring, transform: `scale(${0.92 + 0.08 * ring})` }} />
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

/** The call's own words, timed by Retell, while its recording plays (a live call's panel shows no transcript until it ends). */
export function CallCaptions({ transcript, fromSec }: { transcript: Utterance[]; fromSec: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = fromSec + frame / fps;
  const u = transcript.find((x) => x.words.length && x.words[0].start <= t && t <= x.words[x.words.length - 1].end + 0.8);
  if (!u) return null;
  return (
    <div style={{ position: "absolute", left: 160, right: 160, bottom: 110, textAlign: "center", fontFamily: SANS, fontSize: 44, lineHeight: 1.3, color: C.ink }}>
      <span style={{ padding: "10px 22px", background: "rgb(11 15 20 / 0.88)", borderRadius: 14, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
        <b style={{ color: u.role === "agent" ? C.agent : C.warn }}>{u.role === "agent" ? "Clawback" : "Provider"}: </b>
        {u.words.filter((w) => w.start <= t).map((w) => w.word).join(" ")}
      </span>
    </div>
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
