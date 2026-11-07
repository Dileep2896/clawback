import { randomUUID } from "node:crypto";

// shortcut: plain fetch over the REST API instead of @usenaive-sdk/managed-agents, which would change the root
// lockfile. Upgrade if the adapters grow past a handful of routes.
const BASE_URL = "https://api.vetta.sh/v1";

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

export type NaiveRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};
export type NaiveApi = <T = unknown>(path: string, request?: NaiveRequest) => Promise<T>;

export function createNaiveApi(fetchImpl: typeof fetch = fetch, apiKey: () => string | undefined = () => process.env.NAIVE_API_KEY): NaiveApi {
  return async <T>(path: string, { method = "GET", body, query }: NaiveRequest = {}) => {
    const key = apiKey();
    if (!key) throw new Error("NAIVE_API_KEY is not set");
    const url = new URL(BASE_URL + path);
    for (const [name, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(name, String(value));
    const headers: Record<string, string> = { authorization: `Bearer ${key}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers["idempotency-key"] = randomUUID();
    const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json: { error?: { code?: string; message?: string } } | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body is reported as text below.
    }
    if (!response.ok) {
      const code = json?.error?.code ?? "unknown";
      throw new NaiveError(response.status, code, `naïve ${method} ${path}: ${response.status} ${code} ${json?.error?.message ?? text}`.trim());
    }
    return json as T;
  };
}

/** Reads every page of a cursor-paginated list. */
export async function listAll<T>(api: NaiveApi, path: string, query: NaiveRequest["query"] = {}): Promise<T[]> {
  const rows: T[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await api<{ data: T[]; has_more: boolean; next_cursor: string | null }>(path, { query: { ...query, limit: 100, after } });
    rows.push(...page.data);
    if (!page.has_more || !page.next_cursor) return rows;
    after = page.next_cursor;
  }
}

export const naiveApi = createNaiveApi();

/** naïve money is integer micro-USD on the wire. */
export const microUsd = (usd: number) => Math.round(usd * 1_000_000);
export const usdFromMicro = (micro: number) => micro / 1_000_000;
