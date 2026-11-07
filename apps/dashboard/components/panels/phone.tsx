"use client";

import { useLive } from "../../lib/use-live.tsx";
import { Panel, PanelStub } from "../panel.tsx";

// Stub. panels-action owns this file: read snapshot.sms.
export function Phone() {
  const { snapshot } = useLive();
  return (
    <Panel title="Phone">
      <PanelStub count={snapshot?.sms.length ?? 0} noun="message" />
    </Panel>
  );
}
