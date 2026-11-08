import type { Mailpit } from "@bill-fighter/platform/local/mailpit";
import type { Mail, OutboundEmail } from "@bill-fighter/platform/types";

type Stored = { ID: string; From: { Address: string }; To: string; Subject: string; Text: string; Read: boolean };

const field = (query: string, name: string) => new RegExp(`${name}:"([^"]*)"`).exec(query)?.[1];

/** An in-memory Mailpit and Mail adapter for tests. The query matcher covers only the searches the email path makes. */
export function fakeInbox() {
  const box: Stored[] = [];
  const sent: OutboundEmail[] = [];
  const mail: Mail = {
    async send(email) {
      sent.push(email);
      const ID = `m${box.length + 1}`;
      box.push({ ID, From: { Address: email.from ?? "bills@billfighter.local" }, To: email.to, Subject: email.subject, Text: email.text, Read: false });
      return { id: ID };
    },
    parseInbound: () => {
      throw new Error("not used");
    },
  };
  const mailpit: Mailpit = {
    async search(query) {
      const [to, from, subject] = [field(query, "to"), field(query, "from"), field(query, "subject")];
      return box
        .filter((m) => (!to || m.To === to) && (!from || m.From.Address === from) && (!subject || m.Subject.includes(subject)) && (!query.includes("is:unread") || !m.Read))
        .reverse();
    },
    async read(id) {
      const found = box.find((m) => m.ID === id);
      if (!found) throw new Error(`No message ${id}`);
      return found;
    },
    async markRead(ids) {
      for (const m of box) if (ids.includes(m.ID)) m.Read = true;
    },
  };
  return { box, sent, mail, mailpit };
}
