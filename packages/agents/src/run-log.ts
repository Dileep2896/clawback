import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunEvent } from "@bill-fighter/platform/types";

const DEFAULT_DIR = fileURLToPath(new URL("../../../data/run-events/", import.meta.url));

/** Tool names only: inputs and outputs hold customer data, and audit_log already keeps them. */
function lineOf(event: RunEvent) {
  if (event.type === "text") return `[${event.agent}] ${event.text}`;
  if (event.type === "tool_call") return `[${event.agent}] calls ${event.tool}`;
  if (event.type === "denied") return `[${event.agent}] denied ${event.tool}: ${event.reason}`;
  if (event.type === "result") return `Run ended: ${event.status}, estimated cost $${event.costUsd.toFixed(4)}`;
  return null;
}

/**
 * For executeRun's onEvent: prints each event and appends it to data/run-events/<runId>.log, so a failed run can be read afterwards.
 * Never throws, because an event handler that throws would end the run. Synchronous, so a crash cannot lose the last lines.
 * shortcut: nothing prunes these files, and demo-reset keeps them on purpose. Add pruning if they ever grow past a demo's worth.
 */
export function runEventLog(runId: string, dir = process.env.RUN_EVENT_LOG_DIR || DEFAULT_DIR) {
  const file = join(dir, `${encodeURIComponent(runId)}.log`);
  let warned = false;
  return (event: RunEvent) => {
    const line = lineOf(event);
    if (line === null) return;
    console.info(`${runId} ${line}`);
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch (error) {
      if (!warned) console.warn(`Run ${runId}: could not write its event log:`, error);
      warned = true;
    }
  };
}
