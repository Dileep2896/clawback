import type { Identity } from "../types.ts";
import { naiveClient, need, seg } from "./client.ts";

type Env = Record<string, string | undefined>;
export type Inbox = { id: string; address: string };

/** The identity's inboxes. shortcut: one page of 100, plenty for our two; page through if an identity ever holds more. */
export async function inboxes(env: Env): Promise<Inbox[]> {
  const page = await naiveClient(env)<{ data: Inbox[] }>("GET", `/identities/${seg(need(env, "NAIVE_IDENTITY_ID"))}/emails?limit=100`);
  return page.data;
}

export async function inboxAddress(env: Env, inboxVar: string): Promise<string> {
  const id = need(env, inboxVar);
  const inbox = (await inboxes(env)).find((each) => each.id === id);
  if (!inbox) throw new Error(`${inboxVar} names no inbox of NAIVE_IDENTITY_ID`);
  return inbox.address;
}

/** The naïve persona and its bills@ inbox. naïve holds no number for us (human's decision), so phone stays COMPANY_PHONE. */
export function createIdentity(env: Env = process.env): Identity {
  let cached: ReturnType<Identity["get"]> | undefined;
  const load = async () => {
    const [persona, email] = await Promise.all([
      naiveClient(env)<{ name: string }>("GET", `/identities/${seg(need(env, "NAIVE_IDENTITY_ID"))}`),
      inboxAddress(env, "NAIVE_INBOX_ID"),
    ]);
    return { companyName: persona.name, email, phone: env.COMPANY_PHONE || "+15550002222" };
  };
  return {
    // Cached once it succeeds; a failure is forgotten so the next call retries.
    get: () =>
      (cached ??= load().catch((error) => {
        cached = undefined;
        throw error;
      })),
  };
}

export default createIdentity();
