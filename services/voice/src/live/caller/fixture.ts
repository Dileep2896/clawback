// Test data only. Follows the transcript shape recorded in the spike (docs/plan/voice-design.md): the other AI as role
// `user`, numbers as words, and press_digit as a tool invocation plus a result. Places nothing and calls nothing.
import { DISCLOSURE_LINE } from "@bill-fighter/shared/disclosure";
import { WORDS } from "../../sim/negotiator.ts";
import { CLOSING_LINE, MENU_LINE, REP_LINES } from "../line/script.ts";
import { callRequests, callVariables } from "./agent.ts";
import type { RetellItem } from "./normalize.ts";

export const START_MS = Date.UTC(2026, 10, 6, 12, 0, 0);
export const END_MS = START_MS + 180_000;
export const RECORDING_URL = "https://example.test/recording.wav";
export const RETELL_ID = "call_stub";

let offset = 0;
export const said = (role: "agent" | "user", content: string): RetellItem => ({
  role,
  content,
  words: [{ word: content, start: (offset += 3), end: offset + 2 }],
});

export const press = (digit: string, successful = true): RetellItem[] => [
  { role: "tool_call_invocation", tool_call_id: `press-${digit}`, name: "press_digit", arguments: JSON.stringify({ digit_to_press: digit }) },
  { role: "tool_call_result", tool_call_id: `press-${digit}`, content: "pressed", successful },
];

type Plan = { accountNumber: string; promoAccounts: string[] };
type Line = { number: string; accountNumber: string };

/** A whole good call, with utterances split and the ticket read as words, the way speech-to-text can give them. */
export function fullCallItems(plan: Plan, lines: Line[]): RetellItem[] {
  const variables = callVariables(plan, lines);
  const answers = [...lines.map(() => ["Yes,", "that is canceled."]), ...plan.promoAccounts.map(() => [REP_LINES.promo])];
  return [
    said("agent", DISCLOSURE_LINE),
    said("user", MENU_LINE),
    ...press("2"),
    said("user", "BayTel billing."),
    said("user", "Can I have the account number, please?"),
    said("agent", variables.account_line),
    said("user", REP_LINES.account),
    ...callRequests(plan, lines).flatMap((request, i) => [said("agent", request), ...answers[i]!.map((answer) => said("user", answer))]),
    said("agent", variables.read_back),
    said("user", REP_LINES.confirm),
    said("agent", WORDS.askTicket),
    said("user", "Your ticket number is"),
    said("user", "b, t, four, eight, two, one, three."),
    said("agent", "Let me repeat that: B, T, 4, 8, 2, 1, 3."),
    said("user", REP_LINES.confirm),
    said("agent", WORDS.goodbye),
    said("user", CLOSING_LINE),
  ];
}

export const endedCall = (items: RetellItem[], overrides: Record<string, unknown> = {}) => ({
  call_status: "ended",
  // How a good call ends here, because the line hangs up.
  disconnection_reason: "user_hangup",
  start_timestamp: START_MS,
  end_timestamp: END_MS,
  recording_url: RECORDING_URL,
  transcript_with_tool_calls: items,
  call_cost: { combined_cost: 29 },
  ...overrides,
});

/** Stands in for Retell's API. Answers one `ongoing` read, then `readings` in turn, repeating the last. Records every request. */
export function stubRetell(readings: unknown[], options: { dialStatus?: number; onOngoing?: () => Promise<void> } = {}) {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const queue = [...readings];
  let readCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.pathname === "/v2/create-phone-call") {
      if (options.dialStatus) return new Response("dial refused", { status: options.dialStatus });
      return Response.json({ call_id: RETELL_ID });
    }
    if (url.pathname.startsWith("/v2/stop-call/")) return new Response(null, { status: 204 });
    if (readCount++ === 0) {
      await options.onOngoing?.();
      return Response.json({ call_status: "ongoing" });
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next instanceof Response ? next.clone() : Response.json(next);
  };
  return {
    fetchImpl,
    requests,
    dials: () => requests.filter((request) => request.path === "/v2/create-phone-call"),
  };
}
