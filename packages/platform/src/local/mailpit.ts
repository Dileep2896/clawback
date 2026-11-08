import { z } from "zod";

// Reads the local Mailpit inbox over its HTTP API, for the BayTel email replica and the Negotiator waiting on its reply.
const Summary = z.object({ ID: z.string(), From: z.object({ Address: z.string() }), Subject: z.string(), Read: z.boolean() });
const Search = z.object({ messages: z.array(Summary).nullish() });
const Message = z.object({ ID: z.string(), From: z.object({ Address: z.string() }), Subject: z.string(), Text: z.string() });

export type MailpitMessage = z.infer<typeof Message>;

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
      return Message.parse(await (await call(`/api/v1/message/${encodeURIComponent(id)}`)).json());
    },
    async markRead(ids) {
      if (ids.length === 0) return;
      await call("/api/v1/messages", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: ids, Read: true }) });
    },
  };
}
