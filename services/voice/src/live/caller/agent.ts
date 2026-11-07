import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { lineKey } from "../../sim/engine.ts";
import { WORDS } from "../../sim/negotiator.ts";

export const AGENT_NAME = "baytel-caller";
export const CALLER_NUMBER = "+16506493210";
// Filled in from `cli.ts provision`. While empty, the engine refuses to dial.
export const CALLER_AGENT_ID = "" as string;
export const MAX_CALL_MS = 300_000;

const PROMPT = `You are an AI on a recorded phone call to BayTel Business on behalf of Golden Gate Noodle Company. You follow these steps in order and say only the quoted words, character for character. Never add, rephrase or ask for anything else. Say one step per turn, then wait for the reply.

Your opening line is spoken for you. After it, say nothing until you hear the phone menu.

1. When the menu says to press 2 for billing: use the press digit tool to press 2, and say nothing.
2. When the billing rep asks for the account number: "{{account_line}}"
3. When the rep asks what they can do, make the first request below. After each reply, whatever it says, make the next request. One request per turn, never two.
{{requests}}
4. After the reply to the last request: "{{read_back}}"
5. After the rep confirms: "${WORDS.askTicket}"
6. When the rep reads the ticket number: "Let me repeat that:" and then the letters and digits you heard, one at a time, separated by commas.
7. After the rep confirms: "${WORDS.goodbye}" and then use the end call tool.`;

export function callerLlm() {
  return {
    start_speaker: "agent",
    // Fixed text, so the model never words the disclosure.
    begin_message: DISCLOSURE_LINE,
    model: "gpt-6-luna",
    general_prompt: PROMPT,
    general_tools: [
      { type: "press_digit", name: "press_digit", delay_ms: 500 },
      { type: "end_call", name: "end_call" },
    ],
  };
}

export function callerAgent(llmId: string) {
  return {
    agent_name: AGENT_NAME,
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: "cartesia-Cleo",
    max_call_duration_ms: MAX_CALL_MS,
    end_call_after_silence_ms: 30_000,
    // Applies to the whole call, so neither the disclosure nor a phone number can be cut off.
    interruption_sensitivity: 0,
  };
}

const spaced = (digits: string) => [...digits].join(" ");

// Single digits and spaced letters, which the voice reads one at a time and normalize.ts reads back.
function spokenNumber(number: string) {
  const key = lineKey(number);
  return `${spaced(key.slice(0, 3))}, ${spaced(key.slice(3, 6))}, ${spaced(key.slice(6))}`;
}
function spokenAccount(account: string) {
  const [letters = "", digits = ""] = account.split("-");
  return `${spaced(letters)}, ${spaced(digits)}`;
}

type PlannedLine = { number: string; accountNumber: string };

type CallerPlan = { accountNumber: string; promoAccounts: string[] };

export function callRequests(plan: CallerPlan, lines: PlannedLine[]) {
  return [
    ...lines.map((line) => WORDS.cancel(spokenNumber(line.number), spokenAccount(line.accountNumber))),
    ...plan.promoAccounts.map((account) => WORDS.promo(spokenAccount(account))),
  ];
}

/** Everything specific to this call, as Retell's string-only dynamic variables. Only code-checked lines and approved accounts get in. */
export function callVariables(plan: CallerPlan, lines: PlannedLine[]) {
  return {
    account_line: WORDS.account(spokenAccount(plan.accountNumber)),
    requests: callRequests(plan, lines).map((request) => `- "${request}"`).join("\n"),
    // Each item already has its own yes, so the read-back only counts them, to keep the call short (human's choice).
    read_back: `To confirm, you cancelled ${lines.length} phone lines and restored promo pricing on ${plan.promoAccounts.length} accounts. Is that correct?`,
  };
}
