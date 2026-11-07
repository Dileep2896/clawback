"use client";

import { useLive } from "../../lib/use-live.tsx";
import { Panel, PanelStub } from "../panel.tsx";

// Stub. panels-work owns this file: read snapshot.findings, whose evidenceJson feeds the drawers.
export function Findings() {
  const { snapshot } = useLive();
  return (
    <Panel title="Findings">
      <PanelStub count={snapshot?.findings.length ?? 0} noun="finding" />
    </Panel>
  );
}
