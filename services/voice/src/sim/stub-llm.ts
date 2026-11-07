import type { JsonSchema, Llm, LlmInput } from "@bill-fighter/platform/types";
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { MENU_LINE, REP_LINES } from "../live/line/script.ts";
import { SEED_PLAN } from "./fixture.ts";
import type { Move } from "./negotiator.ts";

// A scripted Llm for tests: plays the seed plan through the sim engine with no model.

export function repAnswer(prompt: string) {
  const last = prompt.split("\n").at(-1)!;
  if (last === `Caller: ${DISCLOSURE_LINE}`) return { lines: [MENU_LINE], endCall: false };
  if (last === "Caller: User's Keypad Entry: 2") return { lines: [REP_LINES.greeting], endCall: false };
  if (last.includes("To confirm") || last.includes("repeat")) return { lines: [REP_LINES.confirm], endCall: false };
  if (last.includes("service address is")) return { lines: [REP_LINES.account], endCall: false };
  if (last.includes("account number is")) return { lines: [REP_LINES.verify], endCall: false };
  if (last.includes("cancel")) return { lines: [REP_LINES.cancel], endCall: false };
  if (last.includes("promo")) return { lines: [REP_LINES.promo], endCall: false };
  if (last.includes("ticket number")) return { lines: [REP_LINES.ticket], endCall: false };
  if (last.includes("Goodbye")) return { lines: [], endCall: true };
  return { lines: [REP_LINES.other], endCall: false };
}

// `nextMove` goes first, so a test can make the model ask for something bad. Returning null plays the call normally.
export function stubLlm(options: { nextMove?: (allowed: string[]) => Move | null; rep?: (input: LlmInput) => unknown } = {}) {
  const lines = [...SEED_PLAN.cancelLines];
  const promos = [...SEED_PLAN.promoAccounts];
  const inputs: { kind: "rep" | "negotiator"; input: LlmInput }[] = [];
  const llm: Llm = {
    async structured<T>(input: LlmInput, schema: JsonSchema) {
      const properties = schema.properties as { move?: { enum: Move["move"][] } };
      if (!properties.move) {
        inputs.push({ kind: "rep", input });
        return (options.rep?.(input) ?? repAnswer(input.prompt)) as T;
      }
      inputs.push({ kind: "negotiator", input });
      const allowed = properties.move.enum;
      const forced = options.nextMove?.(allowed);
      if (forced) return forced as T;
      const move = allowed[0]!;
      const target = move === "press_digit" ? "2" : move === "cancel_line" ? lines.shift()! : move === "restore_promo" ? promos.shift()! : "";
      return { move, target } as T;
    },
  };
  return { llm, inputs };
}
