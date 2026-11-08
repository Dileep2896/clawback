import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, Series, staticFile, useCurrentFrame } from "remotion";
import eventsFile from "../public/events.json";
import transcript from "../public/call.transcript.json";
import scenesFile from "../public/scenes.json";
import { C, CallCaptions, Callout, Chip, Cursor, Grain, SANS, TitleCard, type Utterance, ZoomTo } from "./effects.tsx";
import { clicksIn, eventAt, type Ev, FPS, footageStartMs, layout, type Scene, sceneFrameOf, sceneFrames, stamp } from "./timeline.ts";

export const scenes = scenesFile.scenes as Scene[];
const events = eventsFile.events as Ev[];
const CLICKS = ["get-started", "create-account", "upload-tab", "upload", "approve", "finding", "evidence-close"];
const LEAD = 10; // zooms lead the action by a third of a second
const REFUND_CENTS = 1_260_606;

function SceneView({ s, start, rough }: { s: Scene; start: number; rough: boolean }) {
  const frame = useCurrentFrame();
  const rate = s.footage?.rate ?? 1;
  const from = footageStartMs(s, events);
  const at = (kind: string, offsetSec = 0) => sceneFrameOf(eventAt(events, kind).t, from, rate) + Math.round(offsetSec * FPS);
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {s.card && <TitleCard kind={s.card} />}
      {s.footage && (
        <ZoomTo box={s.zoom && eventAt(events, s.zoom.at).box} start={s.zoom ? at(s.zoom.at, s.zoom.offsetSec) - LEAD : 0} zoom={s.zoom?.scale}>
          <Video src={staticFile("footage/footage.mp4")} muted trimBefore={Math.round((from / 1000) * FPS)} playbackRate={rate} style={{ width: 1920, height: 1080 }} />
          {s.callout && <Callout box={eventAt(events, s.callout).box} start={at(s.callout) + 20} cents={REFUND_CENTS} />}
          <Cursor clicks={clicksIn(s, events, CLICKS)} />
        </ZoomTo>
      )}
      {s.vo && <Audio src={staticFile(`vo/${s.vo}`)} />}
      {s.callAudio && <Audio src={staticFile("call.wav")} trimBefore={Math.round(s.callAudio.fromSec * FPS)} />}
      {s.callAudio && <CallCaptions transcript={transcript as Utterance[]} fromSec={s.callAudio.fromSec} />}
      {rate > 1 && <Chip>{rate}× speed</Chip>}
      {s.label && <Chip at="bottom-left">{s.label}</Chip>}
      {rough && (
        <div style={{ position: "absolute", top: 20, left: 20, padding: "6px 14px", background: "rgb(0 0 0 / 0.75)", color: C.ink, fontFamily: SANS, fontSize: 28 }}>
          {stamp(start + frame)} · {s.id}: {s.title}
          {s.marker && <span style={{ color: C.warn }}> · {s.marker}</span>}
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
