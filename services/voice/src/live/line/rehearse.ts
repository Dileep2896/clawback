import { z } from "zod";
import { MENU_LINE, REP_LINES, TICKET_NUMBER } from "./script.ts";
import type { Vapi } from "./vapi.ts";

export const MAX_RUN_COST_USD = 0.01;

// Limit: Vapi does not document keypad entries in chat, so the entry goes in as plain text.
// This tests the prompt's behavior, not that real tones arrive. `expected: null` means no spoken reply.
export const TURNS: { caller: string; expected: string | null }[] = [
  { caller: "Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded.", expected: MENU_LINE },
  { caller: "Two.", expected: MENU_LINE },
  { caller: "I pressed two already.", expected: MENU_LINE },
  { caller: "User's Keypad Entry: 2", expected: REP_LINES.greeting },
  { caller: "The account number is 4 4 1 0 7 2.", expected: REP_LINES.account },
  { caller: "Please cancel these seven phone lines.", expected: REP_LINES.cancel },
  { caller: "Please restore promo pricing on these three internet accounts.", expected: REP_LINES.promo },
  { caller: "To confirm, the seven lines are cancelled and the three promos are restored?", expected: REP_LINES.confirm },
  { caller: "Can I have a ticket number?", expected: REP_LINES.ticket },
  { caller: `Let me repeat that: ${TICKET_NUMBER}.`, expected: REP_LINES.confirm },
  { caller: "That's everything, thank you. Goodbye.", expected: null },
];

const ChatResponse = z.looseObject({
  id: z.string(),
  cost: z.number().optional(),
  output: z.array(z.looseObject({ role: z.string(), content: z.string().nullish() })),
});

export type TurnResult = { caller: string; expected: string | null; reply: string; ok: boolean };

// One run is one whole conversation. Stops as soon as the run's cost passes the limit or can't be known.
export async function rehearse(
  vapi: Vapi,
  assistantId: string,
  turns = TURNS,
): Promise<{ results: TurnResult[]; costUsd: number; stoppedBecause?: string }> {
  const results: TurnResult[] = [];
  let costUsd = 0;
  let previousChatId: string | undefined;
  for (const { caller, expected } of turns) {
    const chat = ChatResponse.parse(
      await vapi("POST", "/chat", { assistantId, input: caller, ...(previousChatId ? { previousChatId } : {}) }),
    );
    previousChatId = chat.id;
    const reply = chat.output
      .filter((m) => m.role === "assistant")
      .map((m) => m.content ?? "")
      .join(" ")
      .trim();
    results.push({ caller, expected, reply, ok: reply === (expected ?? "") });
    if (chat.cost === undefined) return { results, costUsd, stoppedBecause: "Vapi did not report a cost" };
    costUsd += chat.cost;
    if (costUsd > MAX_RUN_COST_USD) return { results, costUsd, stoppedBecause: "over the one cent limit" };
  }
  return { results, costUsd };
}
