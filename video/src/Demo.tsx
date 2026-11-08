import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, Freeze, Series, staticFile, useCurrentFrame } from "remotion";
import eventsFile from "../public/events.json";
import transcript from "../public/call.transcript.json";
import scenesFile from "../public/scenes.json";
import { Boxes, C, CallCaptions, Callout, Camera, CAPTION, type CaptionPlace, CARD_RECT, cameraAt, Chip, Cursor, EmailCard, Grain, MarketCard, ModelCard, NaiveCard, onScreen, SANS, type Shot, TitleCard, type Utterance, VoCaptions } from "./effects.tsx";
import { type Box, bedGainDb, boxesOf, captionCues, cardTimes, clicksIn, eventAt, type Ev, FPS, footageStartMs, highlightTimes, layout, type Scene, sceneFrameOf, sceneFrames, stamp, unionBox, voiceFrames, type Word } from "./timeline.ts";
import voWords from "./vo-words.json";

export const scenes = scenesFile.scenes as Scene[];
const events = eventsFile.events as Ev[];
const CLICKS = ["get-started", "create-account", "upload-tab", "upload", "collector", "auditor", "follow-live", "approve"];
const WORDS = voWords as Record<string, Word[]>;
const LEAD = 10; // zooms lead the action by a third of a second
const REFUND_CENTS = 1_260_606;
// A spoken figure shown as the screen shows it: the voice rounds the refund to "twelve thousand six hundred".
const SAY_AS = { "$12,600": "$12,606" };
const BED_DB = bedGainDb(scenes, WORDS);
const W = 1920;
const H = 1080;

const overlaps = (a: Box, b: Box, margin = 12) => a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
/** The caption band's box at a place: centred, as wide as its longest line (about half an em a character). */
function bandBox(lines: string[], place: CaptionPlace): Box {
  const h = lines.length * CAPTION.fontSize * CAPTION.lineHeight + CAPTION.padY * 2;
  const w = Math.max(...lines.map((l) => l.length)) * CAPTION.fontSize * 0.5 + CAPTION.padX * 2;
  const y = "top" in place ? place.top : H - place.bottom - h;
  return { x: (W - w) / 2, y, w, h };
}
/** Bottom centre, like the call's captions; at the top if that would cover a box or card; else just above what it would cover. */
function placeCaption(lines: string[], obstacles: Box[]): CaptionPlace {
  const bottom = { bottom: CAPTION.bottom };
  const hit = obstacles.filter((o) => overlaps(bandBox(lines, bottom), o));
  if (!hit.length) return bottom;
  const top = { top: 96 };
  if (!obstacles.some((o) => overlaps(bandBox(lines, top), o))) return top;
  return { bottom: H - Math.min(...hit.map((o) => o.y)) + 16 };
}

function SceneView({ s, start, rough }: { s: Scene; start: number; rough: boolean }) {
  const frame = useCurrentFrame();
  const rate = s.footage?.rate ?? 1;
  const words = WORDS[s.vo ?? ""] ?? [];
  const from = footageStartMs(s, events, words);
  const at = (kind: string, offsetSec = 0) => sceneFrameOf(eventAt(events, kind).t, from, rate) + Math.round(offsetSec * FPS);
  const highlights = highlightTimes(s, words).map((h) => ({ ...h, from: Math.round(h.start * FPS), to: Math.round(h.end * FPS), boxes: boxesOf(eventAt(events, h.box)) }));
  // The camera goes to each named thing as the voice names it; a scene without words may hold one fixed zoom.
  const shots: Shot[] = [
    ...(s.zoom ? [{ frame: at(s.zoom.at, s.zoom.offsetSec) - LEAD, box: eventAt(events, s.zoom.at).box!, scale: s.zoom.scale }] : []),
    ...highlights.map((h) => ({ frame: h.from, box: unionBox(h.boxes) })),
  ];
  const end = sceneFrames(s);
  const voiceEnd = voiceFrames(s);
  const cards = cardTimes(s, words).map((c) => ({ ...c, from: Math.round(c.start * FPS), stepFrame: Math.round((c.step ?? c.start) * FPS) }));
  // What a caption must not cover at a frame: the boxes on screen (through the camera) and the cards.
  const obstaclesAt = (f: number): Box[] => [
    ...highlights.filter((h) => f >= h.from && f <= h.to + 6).flatMap((h) => h.boxes.map((b) => onScreen(b, cameraAt(Math.min(f, voiceEnd), shots, FPS, W, H), W, H))),
    ...cards.filter((c) => f >= c.from).map((c) => CARD_RECT[c.kind]),
  ];
  const cues = captionCues(words, SAY_AS).map((c) => {
    const [from, to] = [Math.round(c.start * FPS), Math.round(c.end * FPS)];
    const obstacles = Array.from({ length: Math.ceil((to - from) / 2) + 1 }, (_, i) => obstaclesAt(from + i * 2)).flat();
    return { from, to, lines: c.lines, place: placeCaption(c.lines, obstacles) };
  });
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {s.card && <TitleCard kind={s.card} />}
      {s.footage && (
        // A scene that holds on after its voice freezes on its last voiced frame (the take moves on to another page).
        <Freeze frame={voiceEnd - 1} active={(f) => f >= voiceEnd}>
          <Camera shots={shots}>
            <Video src={staticFile("footage/footage.mp4")} muted trimBefore={Math.round((from / 1000) * FPS)} playbackRate={rate} style={{ width: 1920, height: 1080 }} />
            <Boxes items={highlights} />
            {highlights.filter((h) => h.count).map((h) => <Callout key={h.box} box={h.boxes[0]} start={h.from + 6} cents={REFUND_CENTS} />)}
            <Cursor clicks={clicksIn(s, events, CLICKS, words)} />
          </Camera>
        </Freeze>
      )}
      {/* The cleaned copy (video/record/audio-prep.ts): wind and gap air taken out. */}
      {s.vo && <Audio src={staticFile(`vo/clean/${s.vo.replace(".m4a", ".wav")}`)} />}
      {s.callAudio && <Audio src={staticFile("call.wav")} trimBefore={Math.round(s.callAudio.fromSec * FPS)} />}
      {s.callAudio && <CallCaptions transcript={transcript as Utterance[]} fromSec={s.callAudio.fromSec} />}
      {s.emailCardAtSec !== undefined && <EmailCard start={Math.round(s.emailCardAtSec * FPS)} />}
      {cards.map((c) =>
        c.kind === "market" ? <MarketCard key={c.kind} start={c.from} step={c.stepFrame} end={end} /> : c.kind === "model" ? <ModelCard key={c.kind} start={c.from} end={end} /> : <NaiveCard key={c.kind} start={c.from} end={end} />,
      )}
      <VoCaptions cues={cues} />
      {rate > 1 && <Chip>{rate}× speed</Chip>}
      {s.label && <Chip at="bottom-left">{s.label}</Chip>}
      {rough && (
        <div style={{ position: "absolute", top: 20, left: 20, padding: "6px 14px", background: "rgb(0 0 0 / 0.75)", color: C.ink, fontFamily: SANS, fontSize: 28 }}>
          {stamp(start + frame)} · {s.id}: {s.title}
          {s.marker && <span style={{ color: C.warn }}> · {s.marker}</span>}
          {highlights.filter((h) => frame >= h.from && frame <= h.to).map((h) => <div key={h.box} style={{ color: C.money }}>“{h.say}” → {h.box}</div>)}
        </div>
      )}
    </AbsoluteFill>
  );
}

export function Demo({ rough = false }: { rough?: boolean }) {
  const { starts } = layout(scenes);
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Series>
        {scenes.map((s, i) => (
          <Series.Sequence key={s.id} durationInFrames={sceneFrames(s)}>
            <SceneView s={s} start={starts[i]} rough={rough} />
          </Series.Sequence>
        ))}
      </Series>
      {/* A pad generated by audio-prep.ts (ours, no licence), ducked under the voice and almost silent under the call. */}
      <Audio src={staticFile("vo/bed.wav")} volume={(f) => 10 ** ((BED_DB[f] ?? -120) / 20)} />
      <Grain />
    </AbsoluteFill>
  );
}
