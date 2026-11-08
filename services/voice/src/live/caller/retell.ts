import { type Allowlist, isAllowedCallNumber } from "@bill-fighter/shared/allowlist";
import { assertNotSandbox } from "@bill-fighter/shared/sandbox";

export const REQUEST_TIMEOUT_MS = 15_000;

/** Retell answered with an error status, as opposed to a request whose result is unknown. */
export class RetellHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Retell = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown, timeoutMs?: number) => Promise<unknown>;

export function retellClient(apiKey: string, allowlist: Allowlist, fetchImpl: typeof fetch = fetch): Retell {
  return async (method, path, body, timeoutMs = REQUEST_TIMEOUT_MS) => {
    assertNotSandbox("place calls");
    // Every request goes through here, so this is the one place a number can be refused before it dials.
    if (method === "POST" && path === "/v2/create-phone-call") {
      const to = (body as { to_number?: unknown } | undefined)?.to_number;
      if (typeof to !== "string" || !isAllowedCallNumber(allowlist, to)) throw new Error(`Refused to dial ${String(to)}: not on the allowlist`);
    } else if (method !== "GET" && /call/i.test(path) && !path.startsWith("/v2/stop-call/")) {
      throw new Error(`Refused ${method} ${path}: calls are only placed through /v2/create-phone-call`);
    }
    const signal = AbortSignal.timeout(timeoutMs);
    const send = async () => {
      const res = await fetchImpl(`https://api.retellai.com${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new RetellHttpError(`Retell ${method} ${path}: HTTP ${res.status}: ${await res.text()}`, res.status);
      // stop-call answers 204 with no body.
      return res.status === 204 ? null : res.json();
    };
    // Raced as well as passed on, so the limit holds for the body read and for whatever fetch is in use.
    const timedOut = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error(`Retell ${method} ${path}: no answer in ${timeoutMs} ms`)), { once: true });
    });
    return Promise.race([send(), timedOut]);
  };
}
