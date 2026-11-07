import { subsetDiff } from "../line/assistant.ts";
import { AGENT_NAME, callerAgent, callerLlm } from "./agent.ts";
import type { Retell } from "./retell.ts";

type Json = Record<string, unknown>;

async function findCaller(retell: Retell): Promise<Json | undefined> {
  let key: string | undefined;
  for (;;) {
    const path = key ? `/v2/list-agents?pagination_key=${encodeURIComponent(key)}` : "/v2/list-agents";
    const page = (await retell("POST", path, {})) as { items?: Json[]; has_more?: boolean; pagination_key?: string };
    const found = page.items?.find((agent) => agent.agent_name === AGENT_NAME);
    if (found || !page.has_more) return found;
    // Stopping here would read as "no caller" and create a duplicate, and following a repeated key would never end.
    if (!page.pagination_key || page.pagination_key === key) throw new Error(`Retell's agent list says it has more, but its next key is "${page.pagination_key ?? ""}"`);
    key = page.pagination_key;
  }
}

/** Creates or updates the caller, and proves it from a read-back. Places no call. Costs no usage, though Retell's docs do not state that. */
export async function provisionCaller(retell: Retell): Promise<{ agentId: string; agentVersion: number; llmId: string }> {
  const existing = await findCaller(retell);
  // The list only has summaries, with no response_engine, so the LLM id needs the agent's own details.
  const details = existing ? ((await retell("GET", `/get-agent/${String(existing.agent_id)}`)) as Json) : undefined;
  const existingLlm = (details?.response_engine as { llm_id?: string } | undefined)?.llm_id;

  const llmConfig = callerLlm();
  const savedLlm = (await (existingLlm ? retell("PATCH", `/update-retell-llm/${existingLlm}`, llmConfig) : retell("POST", "/create-retell-llm", llmConfig))) as Json;
  const llmId = String(savedLlm.llm_id);

  const config = callerAgent(llmId);
  // Off, or Retell may hang up on the line's menu. Sent but not read back: the spike's read-back left both out.
  const body = { ...config, voicemail_option: null, ivr_option: null };
  const savedAgent = (await (existing ? retell("PATCH", `/update-agent/${String(existing.agent_id)}`, body) : retell("POST", "/create-agent", body))) as Json;
  const agentId = String(savedAgent.agent_id);

  const llm = (await retell("GET", `/get-retell-llm/${llmId}`)) as Json;
  const agent = (await retell("GET", `/get-agent/${agentId}`)) as Json;
  const problems = [
    ...subsetDiff(llmConfig, llm).map((path) => `LLM read-back differs at ${path}`),
    ...subsetDiff(config, agent).map((path) => `agent read-back differs at ${path}`),
    ...(agent.voicemail_option ? ["voicemail handling is on"] : []),
    ...(agent.ivr_option ? ["IVR handling is on"] : []),
    ...(Number.isInteger(agent.version) && Number(agent.version) >= 0 ? [] : [`agent read-back has no usable version: ${String(agent.version)}`]),
  ];
  if (problems.length) throw new Error(`Caller is not as designed:\n${problems.join("\n")}`);
  return { agentId, agentVersion: Number(agent.version), llmId };
}
