import { z } from "zod";
import { transcriptRow, type TranscriptRow } from "../../transcript.ts";

// One item of Retell's transcript_with_tool_calls. Utterances also fit, so transcript_object can be read the same way.
export const RetellItem = z.looseObject({
  role: z.string(),
  content: z.string().optional(),
  words: z.array(z.looseObject({ start: z.number().optional() })).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
  arguments: z.string().optional(),
  successful: z.boolean().optional(),
});
export type RetellItem = z.infer<typeof RetellItem>;

const WORD_DIGITS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const WORD = "zero|oh|one|two|three|four|five|six|seven|eight|nine";
const toDigit = (token: string) => WORD_DIGITS[token.toLowerCase()] ?? token;

const DIGIT_RUN = new RegExp(String.raw`\b(?:${WORD}|\d+)(?:[\s,.()-]+(?:${WORD}|\d+))+\b`, "gi");
const PRESSED = new RegExp(String.raw`\bpress (${WORD})\b`, "gi");
// Only with digits after it, so everyday words like "be" and "see" stay as they are.
const ACCOUNT_PREFIX = /\b(?:b|bee|be)[\s,.-]*(?:(t|tee|tea)|(c|see|sea))[\s,.-]*(?=\d)/gi;

/**
 * Makes speech readable by extractOutcome: "B C, seven zero zero two" becomes "BC-7002", and "4 1 5, 5 5 5, 0 1 0 2" one phone number.
 * shortcut: no "double five" or "seven thousand one". The caller is told to read single digits, and anything else leaves the item out, which is the safe side.
 */
export function normalizeSpeech(text: string): string {
  return text
    .replace(DIGIT_RUN, (run) => {
      const tokens = run.split(/[\s,.()-]+/).map(toDigit);
      const joined = tokens.join("");
      // Grouped digits join only as a phone number, so "November 7, 2026" and "$1,234.56" stay as said.
      return tokens.every((token) => token.length === 1) || joined.length === 10 || joined.length === 11 ? joined : run;
    })
    .replace(PRESSED, (_, word: string) => `press ${toDigit(word)}`)
    .replace(ACCOUNT_PREFIX, (_, t?: string) => (t ? "BT-" : "BC-"));
}

function pressedDigit(invocation: RetellItem, items: RetellItem[]): string | null {
  if (invocation.name !== "press_digit") return null;
  const result = items.find((item) => item.role === "tool_call_result" && item.tool_call_id === invocation.tool_call_id);
  // A press Retell did not report as successful is not in the transcript, so it can never claim a tone.
  if (result?.successful !== true) return null;
  try {
    const { digit_to_press: digit } = JSON.parse(invocation.arguments ?? "") as { digit_to_press?: unknown };
    return typeof digit === "string" && /^[0-9*#]$/.test(digit) ? digit : null;
  } catch {
    return null;
  }
}

/** Retell's record of a call as our rows: the other AI (role user) is the provider, split utterances are joined, numbers are normalised. */
export function retellToRows(items: RetellItem[], startMs: number): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let lastAt = new Date(startMs).toISOString();
  for (const item of items) {
    if (item.role === "tool_call_invocation") {
      const digit = pressedDigit(item, items);
      if (digit) rows.push({ ...transcriptRow("agent", "keypress", digit), at: lastAt });
      continue;
    }
    if ((item.role !== "agent" && item.role !== "user") || !item.content?.trim()) continue;
    const role = item.role === "agent" ? "agent" : "provider";
    lastAt = new Date(startMs + (item.words?.[0]?.start ?? 0) * 1000).toISOString();
    const previous = rows.at(-1);
    if (previous?.role === role && previous.kind === "speech") previous.content = `${previous.content} ${item.content.trim()}`;
    else rows.push({ ...transcriptRow(role, "speech", item.content.trim()), at: lastAt });
  }
  // After joining, because a number can be split across two utterances.
  return rows.map((row) => (row.kind === "speech" ? { ...row, content: normalizeSpeech(row.content) } : row));
}
