import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { z } from "zod";
import { CLOSING_LINE, MENU_LINE, REP_LINES } from "./script.ts";

const KEYPAD_ENTRY = /^User's Keypad Entry: ([0-9*#]+)$/;

export const CallMessage = z.looseObject({
  role: z.string(),
  message: z.string().optional(),
  time: z.number().optional(),
  endTime: z.number().optional(),
  duration: z.number().optional(),
  metadata: z.unknown().optional(),
  toolCalls: z.array(z.looseObject({ function: z.looseObject({ name: z.string() }) })).optional(),
});
export type CallMessage = z.infer<typeof CallMessage>;

// A tone is proven only by Vapi's own entry: exact text, one instant in time, with no duration or
// word metadata. Transcribed speech has all of those, so a caller who says these words does not count.
function keypadDigit(m: CallMessage): string | undefined {
  const isInstant = m.time !== undefined && m.time === m.endTime && m.duration === undefined && m.metadata === undefined;
  return m.role === "user" && isInstant ? KEYPAD_ENTRY.exec(m.message ?? "")?.[1] : undefined;
}

export function keypadDigits(messages: CallMessage[]): string[] {
  return messages.flatMap((m) => keypadDigit(m) ?? []);
}

// Speech-to-text spells "canceled" with one l, and the script with two. The real call flagged seven correct replies for it.
const normalize = (text: string) => text.toLowerCase().replace(/canceled/g, "cancelled").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

// What is left of a logged line once script lines are removed. Vapi's log can hold a line twice
// when it was spoken once (voice-design.md), so a repeat alone is not a problem.
function offScript(text: string, allowed: string[]): string {
  let rest = normalize(text);
  for (const line of allowed.map(normalize).sort((a, b) => b.length - a.length)) rest = rest.replaceAll(line, " ");
  return rest.replace(/\s+/g, " ").trim();
}

const REP_ALLOWED = [...Object.values(REP_LINES), CLOSING_LINE];

type Timed = CallMessage & { time: number; endTime: number };
const isTimed = (m: CallMessage): m is Timed => m.time !== undefined && m.endTime !== undefined && m.endTime >= m.time;
const isBot = (m: CallMessage) => m.role === "bot";
const isSpeech = (m: CallMessage) => m.role === "user" && keypadDigit(m) === undefined;

// Problems in one finished call on the line. Empty means the call matches the design. An
// interrupted line shows as off script, which is worth a look even though it is not a fault.
export function checkLineCall(messages: CallMessage[]): string[] {
  const problems: string[] = [];
  for (const m of messages) {
    if (m.role === "tool_calls" && !m.toolCalls?.length) problems.push("a tool call entry names no tool");
    for (const call of m.toolCalls ?? []) {
      if (call.function.name !== "endCall") problems.push(`used tool ${call.function.name}`);
    }
  }

  const said = messages.filter((m) => m.role === "user" || isBot(m));
  for (const m of said) {
    if (!isTimed(m)) problems.push(`a ${m.role} message has no valid timestamps: "${m.message ?? ""}"`);
  }
  // Timestamps decide what came first, not log position. Equal times keep their log order.
  const spoken = said.filter(isTimed).sort((a, b) => a.time - b.time);

  const menu = spoken.find(isBot);
  if (!menu) return [...problems, "the assistant never spoke"];
  const opening = spoken.slice(0, spoken.indexOf(menu)).filter(isSpeech);
  // Joined because the transcriber may split the disclosure across messages. The trailing spaces stop "recordedly" passing.
  const openingText = normalize(opening.map((m) => m.message ?? "").join(" "));
  if (opening.length === 0) problems.push("the assistant spoke before the caller");
  else if (!`${openingText} `.startsWith(`${normalize(DISCLOSURE_LINE)} `)) problems.push("the caller did not open with the full disclosure");
  if (opening.some((m) => m.endTime > menu.time)) problems.push("the assistant spoke over the disclosure");
  if (!normalize(menu.message ?? "").startsWith(normalize(MENU_LINE))) problems.push("the first thing said was not the menu");

  const keypad = spoken.findIndex((m) => keypadDigit(m) === "2");
  const keyPress = spoken[keypad];
  if (!keyPress) problems.push("no platform keypad entry for 2");
  else if (keyPress.time < menu.endTime) problems.push("the key was pressed before the menu finished");

  spoken.forEach((m, i) => {
    if (!isBot(m)) return;
    const inRep = keyPress !== undefined && i > keypad;
    const rest = offScript(m.message ?? "", inRep ? REP_ALLOWED : [MENU_LINE, CLOSING_LINE]);
    if (rest) problems.push(`off script ${inRep ? "as the rep" : "before the key press"}: "${rest}"`);
  });
  if (keyPress) {
    // The greeting, not just any line: an empty entry or the closing line alone is a hang up.
    const repFirst = spoken.slice(keypad + 1).find((m) => isBot(m) && normalize(m.message ?? ""));
    if (!normalize(repFirst?.message ?? "").startsWith(normalize(REP_LINES.greeting))) {
      problems.push("the rep did not open with its greeting after the key press");
    }
  }

  const botText = normalize(spoken.filter(isBot).map((m) => m.message ?? "").join(" "));
  const closingAt = botText.indexOf(normalize(CLOSING_LINE));
  if (closingAt !== -1 && offScript(botText.slice(closingAt), [CLOSING_LINE])) problems.push("the assistant spoke after its closing line");
  return problems;
}
