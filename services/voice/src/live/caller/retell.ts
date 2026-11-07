import { type Allowlist, isAllowedCallNumber } from "@bill-fighter/shared/allowlist";

export type Retell = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown) => Promise<unknown>;

export function retellClient(apiKey: string, allowlist: Allowlist, fetchImpl: typeof fetch = fetch): Retell {
  return async (method, path, body) => {
    // Every request goes through here, so this is the one place a number can be refused before it dials.
    if (method === "POST" && path === "/v2/create-phone-call") {
      const to = (body as { to_number?: unknown } | undefined)?.to_number;
      if (typeof to !== "string" || !isAllowedCallNumber(allowlist, to)) throw new Error(`Refused to dial ${String(to)}: not on the allowlist`);
    } else if (method !== "GET" && /call/i.test(path) && !path.startsWith("/v2/stop-call/")) {
      throw new Error(`Refused ${method} ${path}: calls are only placed through /v2/create-phone-call`);
    }
    const res = await fetchImpl(`https://api.retellai.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`Retell ${method} ${path}: HTTP ${res.status}: ${await res.text()}`);
    // stop-call answers 204 with no body.
    return res.status === 204 ? null : res.json();
  };
}
