import { randomUUID } from "node:crypto";

type Env = Record<string, string | undefined>;

export class NaiveError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NaiveError";
  }
}

/** Names the missing variable, never a value. */
export function need(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set: the naïve adapters need it`);
  return value;
}

// The key is sent to this URL, so only https or a stub on this machine (for tests) is accepted.
function baseUrl(env: Env): string {
  const url = new URL(env.NAIVE_API_URL || "https://api.vetta.sh");
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("NAIVE_API_URL must be https, or http on this machine");
  }
  return url.origin;
}

/** Plain REST against https://api.vetta.sh/v1. A body makes it a write, sent with an Idempotency-Key. */
export function naiveClient(env: Env = process.env) {
  return async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl(env)}/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${need(env, "NAIVE_API_KEY")}`,
        ...(body !== undefined && { "content-type": "application/json", "idempotency-key": randomUUID() }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!response.ok) {
      const code = json?.error?.code ?? "unknown";
      throw new NaiveError(response.status, code, `naïve ${method} ${path.split("?")[0]} failed: ${response.status} ${code}: ${json?.error?.message ?? ""}`);
    }
    return json as T;
  };
}

export const seg = encodeURIComponent;
