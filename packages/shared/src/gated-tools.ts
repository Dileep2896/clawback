export const GATED_TOOLS = [
  "call_provider",
  "submit_claim",
  "change_rate_plan",
  "cancel_service",
  "create_invoice",
  "card_pay",
] as const;

export type GatedTool = (typeof GATED_TOOLS)[number];

export function isGatedTool(name: string): name is GatedTool {
  return (GATED_TOOLS as readonly string[]).includes(name);
}
