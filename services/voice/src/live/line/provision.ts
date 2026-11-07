import { ASSISTANT_NAME, forwardingProblems, lineAssistant, subsetDiff } from "./assistant.ts";
import { LINE_NUMBER } from "./script.ts";
import type { Vapi } from "./vapi.ts";

type Json = Record<string, unknown>;

export async function findLineAssistant(vapi: Vapi): Promise<Json | undefined> {
  const assistants = (await vapi("GET", "/assistant")) as Json[];
  return assistants.find((a) => a.name === ASSISTANT_NAME);
}

// Creates or updates the line's assistant, attaches it to the number, then proves it from a read-back.
export async function provision(vapi: Vapi): Promise<{ assistantId: string; phoneId: string }> {
  const config = lineAssistant();
  const numbers = (await vapi("GET", "/phone-number")) as Json[];
  const number = numbers.find((n) => n.number === LINE_NUMBER);
  if (!number) throw new Error(`${LINE_NUMBER} is not on this Vapi account`);

  const existing = await findLineAssistant(vapi);
  const saved = (await (existing
    ? vapi("PATCH", `/assistant/${String(existing.id)}`, config)
    : vapi("POST", "/assistant", config))) as Json;
  const assistantId = String(saved.id);
  const phoneId = String(number.id);
  await vapi("PATCH", `/phone-number/${phoneId}`, { assistantId });

  const assistant = (await vapi("GET", `/assistant/${assistantId}`)) as Json;
  const phone = (await vapi("GET", `/phone-number/${phoneId}`)) as Json;
  const problems = [
    ...subsetDiff(config, assistant).map((path) => `read-back differs at ${path}`),
    ...forwardingProblems(assistant, phone),
    ...(phone.assistantId === assistantId ? [] : ["the number is not attached to the assistant"]),
  ];
  if (problems.length) throw new Error(`Line is not as designed:\n${problems.join("\n")}`);
  return { assistantId, phoneId };
}
