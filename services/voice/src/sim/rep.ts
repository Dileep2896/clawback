import type { Llm } from "@bill-fighter/platform/types";
import { MENU_LINE, REP_LINES, SYSTEM_PROMPT } from "../live/line/script.ts";
import type { TranscriptRow } from "../transcript.ts";

// Sim only, and deliberately not in script.ts: the live line never refuses.
export const SIM_REFUSAL_LINE = "I'm sorry, I can't do that on this call.";

const SIM_NOTE = `

This is a text simulation. You get the call so far as a log, where the text after "Caller: " is one user message, and the text after "You: " is what you already said. Reply only to the last caller message. Put each line you say in "lines". Using the end call tool means setting "endCall" to true with "lines" empty.`;

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    lines: { type: "array", items: { type: "string", enum: [MENU_LINE, ...Object.values(REP_LINES)] } },
    endCall: { type: "boolean" },
  },
  required: ["lines", "endCall"],
  additionalProperties: false,
};

// The rep never sees system rows, so a refused request reaches it in no form.
const logLine = (row: TranscriptRow) => {
  if (row.role === "system") return [];
  if (row.kind === "keypress") return `Caller: User's Keypad Entry: ${row.content}`;
  return `${row.role === "agent" ? "Caller" : "You"}: ${row.content}`;
};

export const repReply = (llm: Llm, rows: TranscriptRow[], onCost?: (usd: number) => void) =>
  llm.structured<{ lines: string[]; endCall: boolean }>(
    { system: SYSTEM_PROMPT + SIM_NOTE, prompt: rows.flatMap(logLine).join("\n"), ...(onCost ? { onCost } : {}) },
    REPLY_SCHEMA,
  );
