import { ASSISTANT_NAME, forwardingProblems, lineAssistant, subsetDiff } from "./assistant.ts";
import { LINE_NUMBER } from "./script.ts";
import type { Vapi } from "./vapi.ts";

type Json = Record<string, unknown>;

export async function findLineAssistant(vapi: Vapi): Promise<Json | undefined> {
  const assistants = (await vapi("GET", "/assistant")) as Json[];
  return assistants.find((a) => a.name === ASSISTANT_NAME);
}

function lineProblems(config: Json, assistant: Json, phone: Json): string[] {
  return [...subsetDiff(config, assistant).map((path) => `read-back differs at ${path}`), ...forwardingProblems(assistant, phone)];
}

// shortcut: Vapi's schema types assistantId as a string, so null is unproven until a real run, hence the read-back and the loud failure.
// Fallback, squad, workflow and hook routes on the number are ours to report, not to clear, so they stay and the error names them.
// Only ever clears this lane's assistant: the number is read first, so a failed attach cannot disconnect another one.
// shortcut: Vapi has no conditional update, so a change between this read and the detach would be lost; provision is run by hand, so this is unlikely.
async function detach(vapi: Vapi, phoneId: string, ours: string): Promise<string> {
  let holder: unknown;
  try {
    holder = ((await vapi("GET", `/phone-number/${phoneId}`)) as Json).assistantId;
  } catch (err) {
    return `CHECK BY HAND: could not read ${LINE_NUMBER} (${String(err)}), so nothing was detached. It may still point at ${ours}.`;
  }
  if (holder !== ours) return `${LINE_NUMBER} points at ${holder ? String(holder) : "no assistant"}, not this lane's assistant, so it was left alone.`;
  try {
    await vapi("PATCH", `/phone-number/${phoneId}`, { assistantId: null });
    const phone = (await vapi("GET", `/phone-number/${phoneId}`)) as Json;
    if (!phone.assistantId) return "The assistant was detached from the number. Run provision again once this is fixed.";
    return `STILL ATTACHED: ${LINE_NUMBER} still points at ${String(phone.assistantId)}. Detach it by hand.`;
  } catch (err) {
    return `STILL ATTACHED: detaching from ${LINE_NUMBER} failed (${String(err)}). Detach it by hand.`;
  }
}

// Creates or updates the line's assistant, proves it from a read-back, and only then attaches it to the number.
// Any failure with the assistant on the number detaches it, so a bad config is never left callable.
export async function provision(vapi: Vapi): Promise<{ assistantId: string; phoneId: string }> {
  const config = lineAssistant();
  const numbers = (await vapi("GET", "/phone-number")) as Json[];
  const number = numbers.find((n) => n.number === LINE_NUMBER);
  if (!number) throw new Error(`${LINE_NUMBER} is not on this Vapi account`);
  const phoneId = String(number.id);

  const existing = await findLineAssistant(vapi);
  // A re-run updates an assistant that may already be answering the number.
  let ours = existing !== undefined && number.assistantId === existing.id ? String(existing.id) : undefined;
  try {
    const saved = (await (existing
      ? vapi("PATCH", `/assistant/${String(existing.id)}`, config)
      : vapi("POST", "/assistant", config))) as Json;
    const assistantId = String(saved.id);

    const assistant = (await vapi("GET", `/assistant/${assistantId}`)) as Json;
    const before = lineProblems(config, assistant, number);
    if (before.length) throw new Error(`Line is not as designed:\n${before.join("\n")}`);

    // Set before the request: one that appears to fail may still have taken effect.
    ours = assistantId;
    await vapi("PATCH", `/phone-number/${phoneId}`, { assistantId });

    const phone = (await vapi("GET", `/phone-number/${phoneId}`)) as Json;
    const after = [
      ...lineProblems(config, assistant, phone),
      ...(phone.assistantId === assistantId ? [] : ["the number is not attached to the assistant"]),
    ];
    if (after.length) throw new Error(`Line is not as designed:\n${after.join("\n")}`);
    return { assistantId, phoneId };
  } catch (err) {
    if (!ours) throw err;
    throw new Error(`${err instanceof Error ? err.message : String(err)}\n${await detach(vapi, phoneId, ours)}`, { cause: err });
  }
}
