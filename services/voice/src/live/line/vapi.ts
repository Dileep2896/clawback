import { assertNotSandbox } from "@bill-fighter/shared/sandbox";

export type Vapi = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown) => Promise<unknown>;

export function vapiClient(apiKey: string, fetchImpl: typeof fetch = fetch): Vapi {
  return async (method, path, body) => {
    assertNotSandbox("run the voice line");
    // The line only answers calls. Dialing belongs to voice-live-caller, behind the allowlist.
    if (path.startsWith("/call") && method !== "GET") throw new Error("The Vapi line must never place a call");
    const res = await fetchImpl(`https://api.vapi.ai${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 402 && path === "/chat") {
      throw new Error(
        `Text rehearsal cannot run: Vapi chat needs a card on file (HTTP 402: ${await res.text()}). Nothing ran. By the human's decision the account has no card, so the script first runs on the model in the first voice-live-caller full test. See "Mock provider line" in docs/plan/voice-design.md.`,
      );
    }
    if (!res.ok) throw new Error(`Vapi ${method} ${path}: HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  };
}
