import { createElement } from "react";
import { Composition, registerRoot } from "remotion";
import { Demo, scenes } from "./Demo.tsx";
import { FPS, layout } from "./timeline.ts";

registerRoot(() =>
  createElement(Composition, {
    id: "Demo",
    component: Demo,
    durationInFrames: layout(scenes).total,
    fps: FPS,
    width: 1920,
    height: 1080,
    defaultProps: { rough: false },
  }),
);
