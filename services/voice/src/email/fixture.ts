import type { Mailpit, MailpitMessage } from "@bill-fighter/platform/local/mailpit";
import type { Mail, OutboundEmail } from "@bill-fighter/platform/types";

type Stored = MailpitMessage & { Read: boolean };

const field = (query: string, name: string) => new RegExp(`${name}:"([^"]*)"`).exec(query)?.[1];

/** An in-memory Mailpit and Mail adapter for tests. Text comes back with CRLF line ends, as it does through SMTP, and reading a message marks it read, as Mailpit does. The query matcher covers only the searches the email path makes. */
export function fakeInbox() {
  const box: Stored[] = [];
  const sent: OutboundEmail[] = [];
  const deliver = (email: OutboundEmail) => {
    const ID = `m${box.length + 1}`;
    const MessageID = `${ID}@mailpit.test`;
    box.push({
      ID,
      MessageID,
      From: { Address: email.from ?? "bills@billfighter.local" },
      To: [{ Address: email.to }],
      Subject: email.subject,
      Text: email.text.replaceAll("\n", "\r\n"),
      InReplyTo: email.inReplyTo ?? null,
      Read: false,
    });
    return MessageID;
  };
  const mail: Mail = {
    async send(email) {
      sent.push(email);
      return { id: deliver(email) };
    },
    parseInbound: () => {
      throw new Error("not used");
    },
  };
  const mailpit: Mailpit = {
    async search(query) {
      const [to, from, subject, id] = ["to", "from", "subject", "message-id"].map((name) => field(query, name));
      return box
        .filter(
          (m) =>
            (!to || m.To?.some(({ Address }) => Address === to)) &&
            (!from || m.From.Address === from) &&
            (!subject || m.Subject.includes(subject)) &&
            (!id || m.MessageID === id) &&
            (!query.includes("is:unread") || !m.Read),
        )
        .reverse();
    },
    async read(id) {
      const found = box.find((m) => m.ID === id);
      if (!found) throw new Error(`No message ${id}`);
      found.Read = true; // as Mailpit does: fetching a message marks it read
      return found;
    },
    async markRead(ids) {
      for (const m of box) if (ids.includes(m.ID)) m.Read = true;
    },
  };
  // deliver: drops a message into the inbox without the sent list, for a stranger's mail.
  return { box, sent, mail, mailpit, deliver };
}
