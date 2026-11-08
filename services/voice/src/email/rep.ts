// BayTel's email desk on our replica: answers cancellation requests sent to its support address, by the same rules as the phone rep.
import type { Db } from "@bill-fighter/db/client";
import { accounts, customers, locations, phoneLines } from "@bill-fighter/db/schema";
import type { Mailpit } from "@bill-fighter/platform/local/mailpit";
import type { Mail } from "@bill-fighter/platform/types";
import { and, eq } from "drizzle-orm";
import { lineKey } from "../sim/engine.ts";
import { acceptedReply, BAYTEL_SUPPORT, parseRequest, refusalReply } from "./letter.ts";

/** The reply text for one request. Anything off-plan gets a refusal and no ticket. */
export async function answerRequest(db: Db, text: string): Promise<string> {
  const request = parseRequest(text);
  if (!request) return refusalReply("the request needs an account number, the account holder's authorisation and the lines to cancel");
  if (!request.disclosed) return refusalReply("the request does not say who sent it");

  const [account] = await db
    .select({ customerId: customers.id, holder: customers.contactName })
    .from(accounts)
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .innerJoin(customers, eq(locations.customerId, customers.id))
    .where(and(eq(accounts.accountNumber, request.accountNumber), eq(accounts.provider, "baytel")));
  if (!account) return refusalReply(`account ${request.accountNumber} is not a BayTel account`);
  if (request.authorisedBy !== account.holder) return refusalReply("the person named is not the account holder");

  const own = await db
    .select({ number: phoneLines.number, purpose: phoneLines.purpose })
    .from(phoneLines)
    .innerJoin(accounts, eq(phoneLines.accountId, accounts.id))
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .where(and(eq(locations.customerId, account.customerId), eq(accounts.provider, "baytel")));
  const byKey = new Map(own.map((line) => [lineKey(line.number), line]));
  for (const number of request.lines) {
    const line = byKey.get(lineKey(number));
    if (!line) return refusalReply(`line ${number} is not on this customer's BayTel accounts`);
    if (line.purpose === "alarm") return refusalReply(`line ${number} is an alarm line`);
  }
  return acceptedReply(request.accountNumber, request.lines);
}

/** Answers each unread request once, every `intervalMs`. Returns a stop function. */
export function startEmailRep({ db, mail, mailpit, intervalMs = 1000 }: { db: Db; mail: Mail; mailpit: Mailpit; intervalMs?: number }) {
  // Kept as well as the read flag, so a failed markRead never answers a request twice in this process.
  const answered = new Set<string>();
  const warn = (error: unknown) => console.warn(`BayTel email desk: ${error instanceof Error ? error.message : String(error)}`);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const summary of await mailpit.search(`to:"${BAYTEL_SUPPORT}" is:unread`)) {
        if (answered.has(summary.ID)) continue;
        // Done only once the reply is sent: a failure leaves it unread, and the next tick tries again.
        try {
          const message = await mailpit.read(summary.ID);
          const text = await answerRequest(db, message.Text);
          await mail.send({ from: BAYTEL_SUPPORT, to: message.From.Address, subject: `Re: ${message.Subject}`, text, inReplyTo: message.MessageID });
          answered.add(summary.ID);
          await mailpit.markRead([summary.ID]);
        } catch (error) {
          warn(error);
        }
      }
    } catch (error) {
      warn(error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
