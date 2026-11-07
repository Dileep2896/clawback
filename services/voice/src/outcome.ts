import { REP_LINES } from "./live/line/script.ts";
import { lineKey } from "./sim/engine.ts";
import type { TranscriptRow } from "./transcript.ts";

export type CallOutcome = { cancelled_lines: string[]; credits: string[]; ticket: string | null };

const PHONE_NUMBER = /(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)/g;
const PROMO_ACCOUNT = /\bBC-\d+\b/g;

// Speech-to-text punctuates and spells freely, so only the words are compared.
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/canceled/g, "cancelled")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isSpeech = (row: TranscriptRow | undefined, role: TranscriptRow["role"]) => row?.role === role && row.kind === "speech";

// A ticket read digit by digit, such as "B, T, 4, 8". Anything not shaped like a ticket is no ticket.
function ticketIn(row: TranscriptRow) {
  const spoken = /ticket number is (.+)$/i.exec(row.content)?.[1];
  const parts = /^([A-Z]+)(\d+)$/.exec((spoken ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase());
  return parts ? `${parts[1]}-${parts[2]}` : null;
}

/** Lists only what the transcript supports: an item counts when the rep's very next line is the yes to that request. */
export function extractOutcome(rows: TranscriptRow[]): CallOutcome {
  const cancelled = new Set<string>();
  const credits = new Set<string>();
  rows.forEach((row, index) => {
    const answer = rows[index + 1];
    if (!isSpeech(row, "agent") || !isSpeech(answer, "provider")) return;
    const heard = words(answer!.content);
    if (heard === words(REP_LINES.cancel)) for (const [line] of row.content.matchAll(PHONE_NUMBER)) cancelled.add(lineKey(line));
    if (heard === words(REP_LINES.promo)) for (const [account] of row.content.matchAll(PROMO_ACCOUNT)) credits.add(account);
  });
  const ticket = rows.filter((row) => isSpeech(row, "provider")).map(ticketIn).find(Boolean) ?? null;
  return { cancelled_lines: [...cancelled], credits: [...credits], ticket };
}
