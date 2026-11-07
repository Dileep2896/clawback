export type Vapi = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown) => Promise<unknown>;

export function vapiClient(apiKey: string, fetchImpl: typeof fetch = fetch): Vapi {
  return async (method, path, body) => {
    // The line only answers calls. Dialing belongs to voice-live-caller, behind the allowlist.
    if (path.startsWith("/call") && method !== "GET") throw new Error("The Vapi line must never place a call");
    const res = await fetchImpl(`https://api.vapi.ai${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`Vapi ${method} ${path}: HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  };
}
