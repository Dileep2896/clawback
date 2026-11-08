import { z } from "zod";

// Reads the local Mailpit inbox over its HTTP API, for the BayTel email replica and the Negotiator waiting on its reply.
const Summary = z.object({ ID: z.string(), From: z.object({ Address: z.string() }), Subject: z.string(), Read: z.boolean() });
const Search = z.object({ messages: z.array(Summary).nullish() });
const Address = z.object({ Address: z.string() });
const Message = z.object({ ID: z.string(), MessageID: z.string(), From: Address, To: z.array(Address).nullish(), Subject: z.string(), Text: z.string() });
const Headers = z.record(z.string(), z.array(z.string()));

/** `InReplyTo` is the answered Message-ID without angle brackets, or null. */
export type MailpitMessage = z.infer<typeof Message> & { InReplyTo: string | null };

export type Mailpit = {
  /** Mailpit search syntax, such as `to:"a@b.example" is:unread`. Newest first. */
  search(query: string): Promise<z.infer<typeof Summary>[]>;
  read(id: string): Promise<MailpitMessage>;
  markRead(ids: string[]): Promise<void>;
};

export function createMailpit(env: Record<string, string | undefined> = process.env): Mailpit {
  const api = env.MAILPIT_API || "http://localhost:8025";
  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(new URL(path, api), init);
    if (!response.ok) throw new Error(`Mailpit ${init?.method ?? "GET"} ${path}: ${response.status}`);
    return response;
  };
  return {
    async search(query) {
      return Search.parse(await (await call(`/api/v1/search?limit=50&query=${encodeURIComponent(query)}`)).json()).messages ?? [];
    },
    async read(id) {
      const path = `/api/v1/message/${encodeURIComponent(id)}`;
      const message = Message.parse(await (await call(path)).json());
      // The message JSON has no In-Reply-To, so it comes from the raw headers.
      const header = Headers.parse(await (await call(`${path}/headers`)).json())["In-Reply-To"]?.[0];
      return { ...message, InReplyTo: header ? header.trim().replace(/^<|>$/g, "") : null };
    },
    async markRead(ids) {
      if (ids.length === 0) return;
      await call("/api/v1/messages", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: ids, Read: true }) });
    },
  };
}
