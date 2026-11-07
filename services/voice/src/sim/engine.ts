import type { Db } from "@bill-fighter/db/client";
import { accounts, phoneLines } from "@bill-fighter/db/schema";
import type { Llm } from "@bill-fighter/platform/types";
import { eq } from "drizzle-orm";
import { CLOSING_LINE, LINE_NUMBER, REP_LINES } from "../live/line/script.ts";
import { appendRow, closeCall, openCall, transcriptRow, type TranscriptRow } from "../transcript.ts";
import { chooseMove, type Move, type MoveKind, WORDS } from "./negotiator.ts";
import { repReply, SIM_REFUSAL_LINE } from "./rep.ts";

export type CallPlan = { accountNumber: string; cancelLines: string[]; promoAccounts: string[] };

type Stage = "menu" | "account" | "items" | "read_back" | "ticket" | "repeat" | "goodbye";

// Stops a looping model. A clean call takes about 16 turns.
const MAX_TURNS = 40;

const STAGE_MOVES: Record<Exclude<Stage, "items">, MoveKind> = {
  menu: "press_digit",
  account: "give_account",
  read_back: "read_back",
  ticket: "ask_ticket",
  repeat: "repeat_ticket",
  goodbye: "goodbye",
};

// Last ten digits, so "+1 415..." and "(415)..." are the same line.
export const lineKey = (number: string) => number.replace(/\D/g, "").slice(-10);

/** Throws on a line that is unknown or an alarm line, so a bad plan never starts a call of either kind. */
export async function checkPlan(db: Db, plan: CallPlan) {
  // shortcut: reads every customer's lines, which errs toward refusing. Scope by customer if the demo ever has two.
  const knownLines = await db
    .select({ number: phoneLines.number, purpose: phoneLines.purpose, accountNumber: accounts.accountNumber })
    .from(phoneLines)
    .innerJoin(accounts, eq(phoneLines.accountId, accounts.id));
  const lineByKey = new Map(knownLines.map((line) => [lineKey(line.number), line]));

  const planned = plan.cancelLines.map((number) => {
    const line = lineByKey.get(lineKey(number));
    if (!line) throw new Error(`Line ${number} is not on file`);
    if (line.purpose === "alarm") throw new Error(`Line ${number} is an alarm line and is never cancelled`);
    return line;
  });
  return { lineByKey, planned };
}

/**
 * Plays one whole call with no human on it. Rows are stored as they happen, also when the call fails. `refuse` lists
 * items the sim rep turns down. `fallbackReason` says why this call replaced a failed live one.
 */
export async function runSimCall(input: {
  db: Db;
  llm: Llm;
  actionId: string;
  plan: CallPlan;
  refuse?: string[];
  onCost?: (usd: number) => void;
  fallbackReason?: string;
}): Promise<{ callId: string }> {
  const { db, llm, actionId, plan, onCost, fallbackReason } = input;
  const refuse = new Set(input.refuse ?? []);

  const { lineByKey, planned } = await checkPlan(db, plan);

  const { id: callId, first } = await openCall(db, { actionId, toNumber: LINE_NUMBER });
  const rows: TranscriptRow[] = [first];
  const add = async (row: TranscriptRow) => {
    rows.push(row);
    await appendRow(db, callId, row);
  };
  const speak = (content: string) => add(transcriptRow("agent", "speech", content));

  const linesLeft = new Map(planned.map((line) => [lineKey(line.number), line]));
  const promosLeft = new Set(plan.promoAccounts);
  const granted = { lines: [] as string[], promos: [] as string[] };
  // `as`, because closures change these and a plain annotation narrows them to their first value.
  let stage = "menu" as Stage;
  let notice = null as string | null;
  let asked = null as { type: "line" | "promo"; item: string } | null;

  const itemDone = () => {
    asked = null;
    if (linesLeft.size === 0 && promosLeft.size === 0) stage = "read_back";
  };
  const allowed = (): MoveKind[] => {
    if (stage !== "items") return [STAGE_MOVES[stage]];
    return [...(linesLeft.size ? ["cancel_line" as const] : []), ...(promosLeft.size ? ["restore_promo" as const] : [])];
  };
  // True when the rep should now answer. False when no words reached it, so the Negotiator goes again.
  const actOn = async ({ move, target }: Move): Promise<boolean> => {
    if (move === "cancel_line") {
      const line = lineByKey.get(lineKey(target));
      if (line?.purpose === "alarm" || !linesLeft.has(lineKey(target))) {
        const reason = line?.purpose === "alarm" ? `alarm line ${line.number}` : "line not on the approved list";
        notice = `That was refused: ${reason}.`;
        await add(transcriptRow("system", "refused", `Refused by code: ${reason}, not requested.`));
        return false;
      }
      linesLeft.delete(lineKey(target));
      await speak(WORDS.cancel(line!.number, line!.accountNumber));
      asked = { type: "line", item: line!.number };
    } else if (move === "restore_promo") {
      if (!promosLeft.delete(target)) {
        notice = "That was refused: account not on the approved list.";
        await add(transcriptRow("system", "refused", "Refused by code: account not on the approved list, not requested."));
        return false;
      }
      await speak(WORDS.promo(target));
      asked = { type: "promo", item: target };
    } else if (move === "press_digit") {
      if (!/^[0-9*#]$/.test(target)) {
        notice = "press_digit needs one key.";
        return false;
      }
      await add(transcriptRow("agent", "keypress", target));
    } else if (move === "give_account") {
      await speak(WORDS.account(plan.accountNumber));
    } else if (move === "read_back") {
      await speak(WORDS.readBack(granted.lines, granted.promos));
    } else if (move === "ask_ticket") {
      await speak(WORDS.askTicket);
    } else if (move === "repeat_ticket") {
      await speak(WORDS.repeatTicket);
    } else {
      await speak(WORDS.goodbye);
    }
    return true;
  };

  const hear = (lines: string[]) => {
    const said = (line: string) => lines.includes(line);
    if (stage === "menu" && said(REP_LINES.greeting)) stage = "account";
    else if (stage === "account" && said(REP_LINES.account)) {
      stage = "items";
      itemDone();
    } else if (stage === "items" && asked) {
      const { type, item } = asked;
      // Only the rep's own yes counts, so anything else stays out of the read-back.
      if (type === "line" && said(REP_LINES.cancel)) granted.lines.push(item);
      if (type === "promo" && said(REP_LINES.promo)) granted.promos.push(item);
      itemDone();
    } else if (stage === "read_back" && said(REP_LINES.confirm)) stage = "ticket";
    else if (stage === "ticket" && said(REP_LINES.ticket)) stage = "repeat";
    else if (stage === "repeat" && said(REP_LINES.confirm)) stage = "goodbye";
  };

  try {
    // Stored only, not added to `rows`: it is for the screen, and neither model needs a provider's error text.
    if (fallbackReason) await appendRow(db, callId, transcriptRow("system", "fallback", `Live call failed, so this call is simulated: ${fallbackReason}`));
    let repAnswers = true;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (repAnswers) {
        const { lines, endCall } = await repReply(llm, rows, onCost);
        if (lines.length === 0 && !endCall) throw new Error("The rep said nothing");
        for (const line of lines) await add(transcriptRow("provider", "speech", line));
        hear(lines);
        if (endCall) {
          await add(transcriptRow("provider", "speech", CLOSING_LINE));
          // Not the stage: a confirm with endCall reaches "goodbye" before the caller has said it.
          const saidGoodbye = rows.some((row) => row.role === "agent" && row.content === WORDS.goodbye);
          if (!saidGoodbye) throw new Error(`The rep ended the call early, at stage ${stage}`);
          return { callId };
        }
      }

      const move: Move = await chooseMove(llm, {
        rows,
        allowed: allowed(),
        linesLeft: [...linesLeft.values()].map((line) => line.number),
        promosLeft: [...promosLeft],
        notice,
        ...(onCost ? { onCost } : {}),
      });
      notice = null;
      if (!allowed().includes(move.move)) {
        notice = `${move.move} is not available now.`;
        repAnswers = false;
        continue;
      }
      repAnswers = await actOn(move);
      if (repAnswers && asked && refuse.has(asked.item)) {
        await add(transcriptRow("provider", "speech", SIM_REFUSAL_LINE));
        itemDone();
        repAnswers = false;
      }
    }
    throw new Error(`The call did not finish in ${MAX_TURNS} turns`);
  } finally {
    await closeCall(db, callId);
  }
}
