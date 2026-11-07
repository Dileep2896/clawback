import { CLOSING_LINE, SYSTEM_PROMPT } from "./script.ts";

export const ASSISTANT_NAME = "baytel-line";

// Settings the spike proved, except the longer duration for the full script.
export function lineAssistant() {
  return {
    name: ASSISTANT_NAME,
    // The caller's disclosure must come first, so the line never speaks first.
    firstMessageMode: "assistant-waits-for-user",
    // With no messages on the endCall tool, this is what is spoken at hang up, with no LLM choice.
    endCallMessage: CLOSING_LINE,
    keypadInputPlan: { enabled: true, timeoutSeconds: 1, delimiters: [] },
    maxDurationSeconds: 300,
    silenceTimeoutSeconds: 15,
    startSpeakingPlan: { waitSeconds: 1.5 },
    voice: { provider: "vapi", voiceId: "Elliot" },
    model: {
      provider: "openai",
      model: "gpt-6-luna",
      temperature: 0,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      tools: [{ type: "endCall" }],
    },
  };
}

type Json = Record<string, unknown>;

// Everything that could route a caller anywhere but this assistant. No call may reach a personal phone.
export function forwardingProblems(assistant: Json, phone: Json): string[] {
  const problems: string[] = [];
  const model = (assistant.model ?? {}) as { tools?: { type?: string }[]; toolIds?: unknown[] };
  for (const tool of model.tools ?? []) {
    if (tool.type !== "endCall") problems.push(`assistant has tool ${tool.type}`);
  }
  if (model.toolIds?.length) problems.push("assistant has saved tools attached");
  if (assistant.forwardingPhoneNumber) problems.push("assistant has a forwarding number");
  if (assistant.hooks) problems.push("assistant has hooks");
  if (phone.fallbackDestination) problems.push("number has a fallback destination");
  if (phone.squadId) problems.push("number routes to a squad");
  if (phone.workflowId) problems.push("number routes to a workflow");
  return problems;
}

// Paths where the read-back differs from what we sent. Extra fields Vapi adds are fine.
export function subsetDiff(sent: unknown, got: unknown, path = ""): string[] {
  if (Array.isArray(sent)) {
    if (!Array.isArray(got) || got.length !== sent.length) return [path];
    return sent.flatMap((item, i) => subsetDiff(item, got[i], `${path}[${i}]`));
  }
  if (sent !== null && typeof sent === "object") {
    if (got === null || typeof got !== "object") return [path];
    return Object.entries(sent).flatMap(([key, value]) => subsetDiff(value, (got as Json)[key], `${path}.${key}`));
  }
  return sent === got ? [] : [path];
}
