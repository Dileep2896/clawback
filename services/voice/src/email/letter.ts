// The BayTel cancellation email both sides use: built in code from the approved bundle, never worded by a model.
import type { CallFacts } from "../facts.ts";
import { TICKET_NUMBER } from "../live/line/script.ts";
import type { CallOutcome } from "../outcome.ts";
import { lineKey } from "../sim/engine.ts";

export const BAYTEL_SUPPORT = "support@baytel.example";
// Our replica providers only. Checked in code before any send, whatever ALLOWED_EMAIL_DOMAINS says.
export const REPLICA_EMAIL_DOMAINS = ["baytel.example", "baycurrent.example", "bayconnect.example", "bayhearth.example"];
export const REPLY_TIMEOUT_MS = 90_000;
export const DISCLOSURE = "Sent by an AI assistant on behalf of";

export function assertReplicaAddress(address: string) {
  const match = /^[^@\s,;<>]+@([^@\s,;<>]+)$/.exec(address);
  if (!match || !REPLICA_EMAIL_DOMAINS.includes(match[1]!.toLowerCase())) {
    throw new Error(`Email refused: ${address} is not one of our replica providers`);
  }
}

const ACCOUNT = /^Account number: (.+)$/m;
const AUTHORISED = /^Authorised by: (.+), the account holder, on (.+)\.$/m;
const LIST = /^Lines to cancel:\n((?:- .+\n?)+)/m;
const CANCELLED = /^We have cancelled these lines on account .+:\n((?:- .+\n?)+)/m;
const TICKET = /^Ticket: ([A-Z]+-\d+)$/m;
const items = (block: string | undefined) => (block ?? "").split("\n").flatMap((line) => (line.startsWith("- ") ? [line.slice(2).trim()] : []));

/** One email for the whole bundle. Throws when the bundle was not approved by the owner, so an automatic approval never mails a provider. */
export function requestEmail(facts: CallFacts, accountNumber: string, lines: string[], ref: string) {
  if (!facts.byOwner) throw new Error("Only an approval by the account holder can be emailed to the provider");
  const company = facts.company.replace(/\.$/, "");
  return {
    subject: `Cancellation request, account ${accountNumber} (ref ${ref})`,
    text: [
      "Hello BayTel support,",
      "",
      `Please cancel the following lines for ${company}.`,
      "",
      `Account number: ${accountNumber}`,
      `Service address: ${facts.accounts[0]?.address ?? "on file"}`,
      `Authorised by: ${facts.holder}, the account holder, on ${facts.approvedOn}.`,
      "Lines to cancel:",
      ...lines.map((line) => `- ${line}`),
      "",
      "Please reply with a ticket number and the lines you cancelled.",
      "",
      `${DISCLOSURE} ${company}.`,
    ].join("\n"),
  };
}

export type ParsedRequest = { accountNumber: string; authorisedBy: string; lines: string[]; disclosed: boolean };

/** What BayTel reads from a request. Null when a required part is missing. */
export function parseRequest(text: string): ParsedRequest | null {
  const accountNumber = ACCOUNT.exec(text)?.[1]?.trim();
  const authorisedBy = AUTHORISED.exec(text)?.[1]?.trim();
  const lines = items(LIST.exec(text)?.[1]);
  if (!accountNumber || !authorisedBy || lines.length === 0) return null;
  return { accountNumber, authorisedBy, lines, disclosed: text.includes(DISCLOSURE) };
}

export const acceptedReply = (accountNumber: string, lines: string[]) =>
  ["Hello,", "", `We have cancelled these lines on account ${accountNumber}:`, ...lines.map((line) => `- ${line}`), "", `Ticket: ${TICKET_NUMBER}`, "", "BayTel Business support"].join("\n");

export const refusalReply = (reason: string) => ["Hello,", "", `We could not make these changes: ${reason}. Nothing was cancelled.`, "", "BayTel Business support"].join("\n");

/** Only what the reply confirms, and only lines that were asked for, count. Promos are never on the email. */
export function emailOutcome(reply: string, requested: string[]): CallOutcome {
  const asked = new Set(requested.map(lineKey));
  const cancelled = [...new Set(items(CANCELLED.exec(reply)?.[1]).map(lineKey))].filter((key) => asked.has(key));
  return { cancelled_lines: cancelled, credits: [], ticket: TICKET.exec(reply)?.[1] ?? null };
}
