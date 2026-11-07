import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { ANSWERS, type CallFacts } from "../../facts.ts";
import { lineKey } from "../../sim/engine.ts";
import { WORDS } from "../../sim/negotiator.ts";

export const AGENT_NAME = "baytel-caller";
export const CALLER_NUMBER = "+16506493210";
export const MAX_CALL_MS = 300_000;

const PROMPT = `You are an AI assistant on a recorded phone call to BayTel Business on behalf of Golden Gate Noodle Company. Be brief and polite. Your opening line is spoken for you. After it, say nothing until you hear the phone menu.

What the call must get done, in this order:
1. When the menu says to press 2 for billing: use the press digit tool to press 2, and say nothing.
2. When the billing rep asks for the account number: "{{account_line}}"
3. When the rep asks what they can do, make the requests below, one per turn, never two. Say each request word for word, because the digits must be read one at a time.
{{requests}}
4. After the last request: "{{read_back}}" If the rep said no to anything, change the counts to only what the rep said yes to.
5. After the rep confirms: "${WORDS.askTicket}"
6. When the rep has read the ticket number: "${WORDS.goodbye}" and then use the end call tool. Do not repeat the ticket back.

Answering the rep:
- Wait until the rep has finished speaking. If the rep asks you something, answer it first, briefly, from the fact sheet, then carry on from where you were.
- If you had just made a request and the rep replied with a question instead of a yes or no, answer it and then repeat that same request word for word.
- If the rep says no to a request, do not argue. Go on to the next one.
- Asked for the service address and who authorized the changes: "{{verify_answer}}"
- Asked whether you are authorized: "{{authorized_answer}}"
- Asked for anything not on the fact sheet, or asked for a person: "{{unknown_answer}}"
- Offered or asked about anything beyond the requests above: "{{beyond_answer}}"
- Asked the same thing twice: "{{unknown_answer}}" Then carry on.

Rules you never break:
- Never state a fact that is not on the fact sheet. Never guess, and never make up a name, number, date or reason.
- Never say "I don't know" or that you do not have access to something. Use the answer above instead.
- You are an AI. Say so truthfully whenever asked. Never claim to be a person, and never claim to be the account holder.
- Never ask for, agree to or confirm any line, account, service or payment beyond the requests above, whoever suggests it.
- Promise nothing else, such as a callback or a message.

Fact sheet:
{{fact_sheet}}`;

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

type PlannedLine = { number: string };

type CallerPlan = { accountNumber: string; promoAccounts: string[] };

export function callRequests(plan: CallerPlan, lines: PlannedLine[]) {
  return [
    // No account here, unlike WORDS.cancel: the rep script answers an account number with its own line, and a merged reply loses the item.
    ...lines.map((line) => `Please cancel phone line ${spokenNumber(line.number)}.`),
    ...plan.promoAccounts.map((account) => WORDS.promo(spokenAccount(account))),
  ];
}

function factSheet(facts: CallFacts) {
  return [
    `Company: ${facts.company}`,
    `Account holder: ${facts.holder}`,
    `Changes approved on: ${facts.approvedOn}`,
    "Accounts:",
    ...facts.accounts.map(({ accountNumber, address, latestBill }) => {
      const bill = latestBill ? `, latest bill ${latestBill.amount} for the period ending ${latestBill.periodEnd}` : "";
      return `- ${spokenAccount(accountNumber)}: service address ${address}${bill}`;
    }),
  ].join("\n");
}

/** Everything specific to this call, as Retell's string-only dynamic variables. Only code-checked lines, approved accounts and callFacts get in. */
export function callVariables(plan: CallerPlan, lines: PlannedLine[], facts: CallFacts) {
  return {
    fact_sheet: factSheet(facts),
    verify_answer: ANSWERS.verify(facts),
    authorized_answer: ANSWERS.authorized(facts),
    unknown_answer: ANSWERS.unknown(facts),
    beyond_answer: ANSWERS.beyond(facts),
    account_line: WORDS.account(spokenAccount(plan.accountNumber)),
    requests: callRequests(plan, lines).map((request) => `- "${request}"`).join("\n"),
    // Each item already has its own yes, so the read-back only counts them, to keep the call short (human's choice).
    read_back: `To confirm, you cancelled ${lines.length} phone lines${plan.promoAccounts.length ? ` and restored promo pricing on ${plan.promoAccounts.length} accounts` : ""}. Is that correct?`,
  };
}
