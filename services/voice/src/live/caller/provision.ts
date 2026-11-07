import { subsetDiff } from "../line/assistant.ts";
import { AGENT_NAME, callerAgent, callerLlm } from "./agent.ts";
import type { Retell } from "./retell.ts";

type Json = Record<string, unknown>;

/** Creates or updates the caller, and proves it from a read-back. Places no call. Costs no usage, though Retell's docs do not state that. */
export async function provisionCaller(retell: Retell): Promise<{ agentId: string; llmId: string }> {
  const { items = [] } = (await retell("POST", "/v2/list-agents", {})) as { items?: Json[] };
  const existing = items.find((agent) => agent.agent_name === AGENT_NAME);
  const existingLlm = (existing?.response_engine as { llm_id?: string } | undefined)?.llm_id;

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
  ];
  if (problems.length) throw new Error(`Caller is not as designed:\n${problems.join("\n")}`);
  return { agentId, llmId };
}
