import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { z } from "zod";
import { CLOSING_LINE, MENU_LINE, REP_LINES } from "./script.ts";

const KEYPAD_PREFIX = "User's Keypad Entry:";

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

// A tone is proven only by Vapi's own entry: one instant in time, with no duration or word
// metadata. Transcribed speech has all of those, so a caller who says these words does not count.
function isKeypadEntry(m: CallMessage): boolean {
  return (
    m.role === "user" &&
    (m.message ?? "").startsWith(KEYPAD_PREFIX) &&
    m.time !== undefined &&
    m.time === m.endTime &&
    m.duration === undefined &&
    m.metadata === undefined
  );
}

export function keypadDigits(messages: CallMessage[]): string[] {
  return messages.filter(isKeypadEntry).map((m) => (m.message ?? "").slice(KEYPAD_PREFIX.length).trim());
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// What is left of a logged line once script lines are removed. Vapi's log can hold a line twice
// when it was spoken once (voice-design.md), so a repeat alone is not a problem.
function offScript(text: string, allowed: string[]): string {
  let rest = normalize(text);
  for (const line of allowed.map(normalize).sort((a, b) => b.length - a.length)) rest = rest.replaceAll(line, " ");
  return rest.replace(/\s+/g, " ").trim();
}

const REP_ALLOWED = [...Object.values(REP_LINES), CLOSING_LINE];

// Problems in one finished call on the line. Empty means the call matches the design. An
// interrupted line shows as off script, which is worth a look even though it is not a fault.
export function checkLineCall(messages: CallMessage[]): string[] {
  const problems: string[] = [];
  const firstBot = messages.findIndex((m) => m.role === "bot");
  const firstSpeech = messages.findIndex((m) => m.role === "user" && !isKeypadEntry(m));
  const keypad = messages.findIndex((m) => isKeypadEntry(m) && (m.message ?? "").endsWith(": 2"));

  if (firstBot === -1) return ["the assistant never spoke"];
  // Joined because the transcriber may split the disclosure across messages.
  const opening = messages
    .slice(0, firstBot)
    .filter((m) => m.role === "user" && !isKeypadEntry(m))
    .map((m) => m.message ?? "")
    .join(" ");
  if (firstSpeech === -1 || firstSpeech > firstBot) problems.push("the assistant spoke before the caller");
  else if (!normalize(opening).startsWith(normalize(DISCLOSURE_LINE))) problems.push("the caller did not open with the full disclosure");
  if (!normalize(messages[firstBot]?.message ?? "").includes(normalize(MENU_LINE))) {
    problems.push("the first thing said was not the menu");
  }
  if (keypad === -1) problems.push("no platform keypad entry for 2");

  let repGreeted = false;
  messages.forEach((m, i) => {
    if (m.role === "bot") {
      const inRep = keypad !== -1 && i > keypad;
      // The greeting, not just any line: an empty entry or the closing line alone is a hang up.
      repGreeted ||= inRep && normalize(m.message ?? "").includes(normalize(REP_LINES.greeting));
      const rest = offScript(m.message ?? "", inRep ? REP_ALLOWED : [MENU_LINE, CLOSING_LINE]);
      if (rest) problems.push(`off script ${inRep ? "as the rep" : "before the key press"}: "${rest}"`);
    }
    for (const call of m.toolCalls ?? []) {
      if (call.function.name !== "endCall") problems.push(`used tool ${call.function.name}`);
    }
  });
  if (keypad !== -1 && !repGreeted) problems.push("the rep never answered after the key press");
  return problems;
}
