import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, Series, staticFile, useCurrentFrame } from "remotion";
import eventsFile from "../public/events.json";
import transcript from "../public/call.transcript.json";
import scenesFile from "../public/scenes.json";
import { Boxes, C, CallCaptions, Callout, Camera, Chip, Cursor, EmailCard, Grain, SANS, type Shot, TitleCard, type Utterance } from "./effects.tsx";
import { boxesOf, clicksIn, eventAt, type Ev, FPS, footageStartMs, highlightTimes, layout, type Scene, sceneFrameOf, sceneFrames, stamp, unionBox, type Word } from "./timeline.ts";
import voWords from "./vo-words.json";

export const scenes = scenesFile.scenes as Scene[];
const events = eventsFile.events as Ev[];
const CLICKS = ["get-started", "create-account", "upload-tab", "upload", "collector", "auditor", "follow-live", "approve"];
const WORDS = voWords as Record<string, Word[]>;
const LEAD = 10; // zooms lead the action by a third of a second
const REFUND_CENTS = 1_260_606;

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
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {s.card && <TitleCard kind={s.card} />}
      {s.footage && (
        <Camera shots={shots}>
          <Video src={staticFile("footage/footage.mp4")} muted trimBefore={Math.round((from / 1000) * FPS)} playbackRate={rate} style={{ width: 1920, height: 1080 }} />
          <Boxes items={highlights} />
          {highlights.filter((h) => h.count).map((h) => <Callout key={h.box} box={h.boxes[0]} start={h.from + 6} cents={REFUND_CENTS} />)}
          <Cursor clicks={clicksIn(s, events, CLICKS, words)} />
        </Camera>
      )}
      {s.vo && <Audio src={staticFile(`vo/${s.vo}`)} />}
      {s.callAudio && <Audio src={staticFile("call.wav")} trimBefore={Math.round(s.callAudio.fromSec * FPS)} />}
      {s.callAudio && <CallCaptions transcript={transcript as Utterance[]} fromSec={s.callAudio.fromSec} />}
      {s.emailCardAtSec !== undefined && <EmailCard start={Math.round(s.emailCardAtSec * FPS)} />}
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
      <Grain />
    </AbsoluteFill>
  );
}
