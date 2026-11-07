import type { Llm } from "@bill-fighter/platform/types";
import { SPOKEN_TICKET } from "../live/line/script.ts";
import type { TranscriptRow } from "../transcript.ts";

export type MoveKind =
  | "press_digit"
  | "give_account"
  | "give_verification"
  | "cancel_line"
  | "restore_promo"
  | "read_back"
  | "ask_ticket"
  | "repeat_ticket"
  | "goodbye";

export type Move = { move: MoveKind; target: string };

const SYSTEM = `You are the Negotiator, an AI on a recorded phone call to a provider on behalf of Golden Gate Noodle Company. You do not write what is said. Each turn you pick the next move, and code speaks it.

Moves and their target:
- press_digit: the single key the phone menu asks for
- cancel_line: a phone number from the lines to cancel
- restore_promo: an account number from the promo accounts
- give_account, give_verification, read_back, ask_ticket, repeat_ticket, goodbye: an empty string`;

const logLine = (row: TranscriptRow) => {
  if (row.role === "system") return `System: ${row.content}`;
  if (row.kind === "keypress") return `You pressed: ${row.content}`;
  return `${row.role === "agent" ? "You" : "Provider"}: ${row.content}`;
};

export function chooseMove(
  llm: Llm,
  turn: {
    rows: TranscriptRow[];
    allowed: MoveKind[];
    linesLeft: string[];
    promosLeft: string[];
    notice: string | null;
    onCost?: (usd: number) => void;
  },
) {
  const prompt = [
    `The call so far:\n${turn.rows.map(logLine).join("\n")}`,
    `Lines to cancel, not yet requested: ${turn.linesLeft.join(", ") || "none"}`,
    `Promo accounts to restore, not yet requested: ${turn.promosLeft.join(", ") || "none"}`,
    ...(turn.notice ? [`Your last move was not used: ${turn.notice}`] : []),
    `Pick your next move from: ${turn.allowed.join(", ")}.`,
  ].join("\n\n");
  return llm.structured<Move>(
    { system: SYSTEM, prompt, ...(turn.onCost ? { onCost: turn.onCost } : {}) },
    {
      type: "object",
      properties: { move: { type: "string", enum: turn.allowed }, target: { type: "string" } },
      required: ["move", "target"],
      additionalProperties: false,
    },
  );
}

export const WORDS = {
  account: (accountNumber: string) => `The account number is ${accountNumber}.`,
  cancel: (number: string, accountNumber: string) => `Please cancel phone line ${number} on account ${accountNumber}.`,
  promo: (accountNumber: string) => `Please restore promo pricing on BayConnect internet account ${accountNumber}.`,
  readBack(lines: string[], promos: string[]) {
    const parts = [
      ...(lines.length ? [`you cancelled phone lines ${lines.join(", ")}`] : []),
      ...(promos.length ? [`you restored promo pricing on BayConnect accounts ${promos.join(", ")}`] : []),
    ];
    return parts.length ? `To confirm, ${parts.join(" and ")}. Is that correct?` : "To confirm, nothing was changed on this call. Is that correct?";
  },
  askTicket: "Can I have a ticket number, please?",
  repeatTicket: `Let me repeat that: ${SPOKEN_TICKET}.`,
  goodbye: "That's everything, thank you. Goodbye.",
};
