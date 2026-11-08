import type { Db } from "@bill-fighter/db/client";
import { calls } from "@bill-fighter/db/schema";
import { withTestDb } from "@bill-fighter/db/test-db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TICKET_NUMBER } from "../live/line/script.ts";
import { lineKey } from "../sim/engine.ts";
import { ALARM_LINES, SEED_PLAN, seedCallData, seedCallFacts } from "../sim/fixture.ts";
import type { TranscriptRow } from "../transcript.ts";
import { runEmail } from "./engine.ts";
import { fakeInbox } from "./fixture.ts";
import { acceptedReply, assertReplicaAddress, emailOutcome, parseRequest, requestEmail } from "./letter.ts";
import { answerRequest, startEmailRep } from "./rep.ts";

const ACTION = "email-action";
const PLAN = { ...SEED_PLAN, promoAccounts: [] };
const FACTS = { company: "Golden Gate Noodle Co.", holder: "Linda Park", approvedOn: "November 7, 2026", byOwner: true, accounts: [{ accountNumber: "BT-7001", address: "1 Main St", latestBill: null }] };

const withData = (name: string, fn: (db: Db) => Promise<void>) =>
  it(name, () =>
    withTestDb("email_negotiator", async (db) => {
      await seedCallData(db, ACTION, PLAN);
      await seedCallFacts(db, ACTION);
      await fn(db);
    }),
  );

describe("the request email", () => {
  it("refuses any recipient outside our replica providers", () => {
    expect(() => assertReplicaAddress("support@baytel.example")).not.toThrow();
    for (const bad of ["support@baytel.com", "support@att.com", "a@baytel.example,b@att.com", "support@evil.baytel.example", "baytel.example"]) {
      expect(() => assertReplicaAddress(bad), bad).toThrow(/not one of our replica providers/);
    }
  });

  it("carries the account, every line, the owner's approval and the AI disclosure, and BayTel reads it back", () => {
    const { subject, text } = requestEmail(FACTS, "BT-7001", PLAN.cancelLines, "ref1");
    expect(subject).toBe("Cancellation request, account BT-7001 (ref ref1)");
    expect(text).toContain("Linda Park, the account holder, on November 7, 2026.");
    expect(text).toContain("Sent by an AI assistant on behalf of Golden Gate Noodle Co.");
    expect(parseRequest(text)).toEqual({ accountNumber: "BT-7001", authorisedBy: "Linda Park", lines: PLAN.cancelLines, disclosed: true });
  });

  it("reads a request and a reply that came back through SMTP with CRLF line ends", () => {
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");
    expect(parseRequest(crlf(requestEmail(FACTS, "BT-7001", PLAN.cancelLines, "r").text))?.lines).toEqual(PLAN.cancelLines);
    expect(emailOutcome(crlf(acceptedReply("BT-7001", PLAN.cancelLines)), PLAN.cancelLines)).toEqual({ cancelled_lines: PLAN.cancelLines.map(lineKey), credits: [], ticket: TICKET_NUMBER });
  });

  it("is never written for an automatic approval", () => {
    expect(() => requestEmail({ ...FACTS, byOwner: false }, "BT-7001", PLAN.cancelLines, "r")).toThrow(/account holder/);
  });

  it("counts only requested lines the reply confirms, and its ticket", () => {
    const [first, second] = PLAN.cancelLines;
    expect(emailOutcome(acceptedReply("BT-7001", [first!, "+15559999999"]), [first!, second!])).toEqual({ cancelled_lines: [lineKey(first!)], credits: [], ticket: TICKET_NUMBER });
    expect(emailOutcome("We could not make these changes: x. Nothing was cancelled.", [first!])).toEqual({ cancelled_lines: [], credits: [], ticket: null });
  });
});

describe("BayTel's email desk", () => {
  const request = (patch: Partial<typeof FACTS> = {}, lines = PLAN.cancelLines, account = "BT-7001") => requestEmail({ ...FACTS, ...patch }, account, lines, "r").text;

  withData("cancels the lines of a correct request, with a ticket", async (db) => {
    const reply = await answerRequest(db, request());
    expect(emailOutcome(reply, PLAN.cancelLines)).toEqual({ cancelled_lines: PLAN.cancelLines.map(lineKey), credits: [], ticket: TICKET_NUMBER });
  });

  withData("refuses a wrong name, an unknown account, an alarm line, a stranger's line and a missing disclosure", async (db) => {
    const refusals = [
      request({ holder: "Someone Else" }),
      request({}, PLAN.cancelLines, "BT-0000"),
      request({}, [ALARM_LINES[0]!]),
      request({}, ["+15559999999"]),
      request().replace("Sent by an AI assistant on behalf of", "From"),
    ];
    for (const text of refusals) {
      const reply = await answerRequest(db, text);
      expect(reply, text).toContain("Nothing was cancelled");
      expect(emailOutcome(reply, PLAN.cancelLines).ticket).toBeNull();
    }
  });
});

describe("runEmail", () => {
  withData("sends the request, waits for the desk's reply and stores both on an email call row", async (db) => {
    const inbox = fakeInbox();
    const stop = startEmailRep({ db, mail: inbox.mail, mailpit: inbox.mailpit, intervalMs: 5 });
    try {
      const { callId } = await runEmail({ db, mail: inbox.mail, mailpit: inbox.mailpit, actionId: ACTION, plan: PLAN, pollMs: 5 });
      const [row] = await db.select().from(calls).where(eq(calls.id, callId));
      expect(row).toMatchObject({ mode: "email", toNumber: "support@baytel.example" });
      expect(row!.endedAt).not.toBeNull();
      const rows = row!.transcriptJson as TranscriptRow[];
      expect(rows.map(({ role, kind }) => `${role}:${kind}`)).toEqual(["agent:email", "provider:email"]);
      expect(emailOutcome(rows[1]!.content, PLAN.cancelLines).cancelled_lines).toHaveLength(PLAN.cancelLines.length);
      expect(inbox.sent.map(({ to }) => to)).toEqual(["support@baytel.example", "bills@billfighter.local"]);
    } finally {
      stop();
    }
  });

  withData("ignores BayTel mail with the request's subject that is not a reply to our request, or not to us", async (db) => {
    const inbox = fakeInbox();
    // Answers each request twice, both wrong: In-Reply-To another message, and the right In-Reply-To to someone else.
    const forger = setInterval(() => {
      for (const request of inbox.box.filter((m) => m.To?.[0]?.Address === "support@baytel.example" && !m.Read)) {
        request.Read = true;
        const reply = { from: "support@baytel.example", subject: `Re: ${request.Subject}`, text: acceptedReply("BT-7001", PLAN.cancelLines) };
        inbox.deliver({ ...reply, to: "bills@billfighter.local", inReplyTo: "unrelated@mailpit.test" });
        inbox.deliver({ ...reply, to: "someone@billfighter.local", inReplyTo: request.MessageID });
      }
    }, 2);
    try {
      await expect(runEmail({ db, mail: inbox.mail, mailpit: inbox.mailpit, actionId: ACTION, plan: PLAN, timeoutMs: 60, pollMs: 5 })).rejects.toThrow(/No reply from BayTel/);
    } finally {
      clearInterval(forger);
    }
    expect(inbox.box.filter((m) => m.Subject.startsWith("Re: "))).toHaveLength(2);
    const [row] = await db.select().from(calls);
    expect((row!.transcriptJson as TranscriptRow[]).map(({ role }) => role)).toEqual(["agent", "system"]);
    expect(row!.outcomeJson).toBeNull();
  });

  withData("the desk retries a request whose reply failed to send, and answers it once", async (db) => {
    const inbox = fakeInbox();
    const send = inbox.mail.send;
    let failures = 1;
    inbox.mail.send = async (email) => {
      if (email.from === "support@baytel.example" && failures-- > 0) throw new Error("SMTP down");
      return send(email);
    };
    const stop = startEmailRep({ db, mail: inbox.mail, mailpit: inbox.mailpit, intervalMs: 5 });
    try {
      await runEmail({ db, mail: inbox.mail, mailpit: inbox.mailpit, actionId: ACTION, plan: PLAN, pollMs: 5 });
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      stop();
    }
    expect(failures).toBe(-1);
    expect(inbox.sent.filter(({ from }) => from === "support@baytel.example")).toHaveLength(1);
  });

  withData("refuses a non-replica recipient before sending anything", async (db) => {
    const inbox = fakeInbox();
    await expect(runEmail({ db, mail: inbox.mail, mailpit: inbox.mailpit, actionId: ACTION, plan: PLAN, to: "support@baytel.com" })).rejects.toThrow(/replica/);
    expect(inbox.sent).toEqual([]);
    expect(await db.$count(calls)).toBe(0);
  });

  withData("gives up after the timeout with a notice on the row, and throws", async (db) => {
    const inbox = fakeInbox();
    await expect(runEmail({ db, mail: inbox.mail, mailpit: inbox.mailpit, actionId: ACTION, plan: PLAN, timeoutMs: 30, pollMs: 5 })).rejects.toThrow(/No reply from BayTel/);
    const [row] = await db.select().from(calls);
    expect((row!.transcriptJson as TranscriptRow[]).at(-1)).toMatchObject({ role: "system", kind: "status" });
    expect(row!.outcomeJson).toBeNull();
  });

  withData("refuses an alarm line before any email", async (db) => {
    const inbox = fakeInbox();
    await expect(runEmail({ db, mail: inbox.mail, mailpit: inbox.mailpit, actionId: ACTION, plan: { ...PLAN, cancelLines: [ALARM_LINES[0]!] } })).rejects.toThrow(/alarm/);
    expect(inbox.sent).toEqual([]);
  });
});
