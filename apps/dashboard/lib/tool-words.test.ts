import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TOOL_WORDS, toolWords } from "./tool-words.ts";

const root = new URL("../../../", import.meta.url);
// Every tool name the agents define, and every tool the recorded demo run called.
const defined = readdirSync(new URL("packages/agents/src/tools/", root), { recursive: true })
  .filter((file) => String(file).endsWith(".ts") && !String(file).endsWith(".test.ts"))
  .flatMap((file) => [...readFileSync(new URL(`packages/agents/src/tools/${file}`, root), "utf8").matchAll(/\bname: "([a-z_]+)"/g)].map((m) => m[1]!));
const recorded = [...readFileSync(new URL("data/replay/run.jsonl", root), "utf8").matchAll(/"tool":"([a-z_]+)"/g)].map((m) => m[1]!);

it("has plain words for every tool an agent defines or the demo run called", () => {
  // Not tools: the platform and demo entries in the registry.
  const tools = new Set([...defined, ...recorded].filter((name) => !["demo", "platform"].includes(name)));
  expect(tools.size).toBeGreaterThan(20);
  expect([...tools].filter((tool) => !(tool in TOOL_WORDS))).toEqual([]);
});

it("turns an unknown tool into a sentence rather than showing its raw name", () => {
  expect(toolWords("portal_login")).toBe("Log in to the provider's portal");
  expect(toolWords("refund_dance")).toBe("Refund dance");
});

it("names the step without claiming it worked, since denied and failed attempts are logged too", () => {
  // A denied card_pay or a refused cancel_service row must not read "Charged" or "Cancelled".
  const claims = Object.entries(TOOL_WORDS).filter(([, words]) => /^\w+ed\b|^(Sent|Paid)\b/.test(words));
  expect(claims).toEqual([]);
  expect(toolWords("card_pay")).toBe("Charge the card on file");
  expect(toolWords("create_invoice")).toBe("Create Clawback's invoice");
});
