import { RUN_CARD_AGENT } from "@bill-fighter/shared/run-card";

/** A run that ended without finishing its work, such as error or over_budget. Nothing is listening for a decision any more. */
export const isStopped = (status: string | undefined) => status !== undefined && status !== "running" && status !== "success";

export const STOPPED_TEXT = "This run stopped, so nothing can be approved.";

// Shown under the choice on the approval card and written in the approval's audit row (orchestrator, 2026-11-08).
export const EMAIL_INSTEAD = "We will email BayTel instead of calling.";

/** What the run itself reported as wrong, for the header. A card an agent marked blocked stays on the board only. */
export const runProblems = (cards: { agent: string; status: string; title: string }[]) =>
  cards.filter((card) => card.agent === RUN_CARD_AGENT && card.status === "blocked").map((card) => card.title);

// runs.status is free text such as running, success or over_budget.
export const statusLabel = (status: string) => {
  const words = status.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

type Bundle = { status: string; actionIds: string[] } | null | undefined;

// decideApproval records the decision on the bundle and leaves its actions and findings at "proposed", so the bundle says what happened.
const DECISIONS: Record<string, string> = { approved: "Approved, agents at work", denied: "Denied by you" };
const decision = (approval: Bundle, actionId: string) =>
  approval && approval.actionIds.includes(actionId) ? DECISIONS[approval.status] : undefined;

const FINDING_STATES: Record<string, string> = {
  proposed: "Waiting for your approval",
  approved: "Approved, agents at work",
  filed: "Filed with the provider",
  won: "Won",
  rejected: "Turned down",
};

/** A finding no action points at was found and left alone, such as an expired promo: say so rather than imply work on it. */
export function findingState(finding: { id: string; status: string }, actions: { id: string; findingId: string | null }[], approval: Bundle) {
  const own = actions.filter((action) => action.findingId === finding.id);
  if (own.length === 0) return "Found, not acted on";
  if (finding.status !== "proposed") return FINDING_STATES[finding.status] ?? finding.status;
  return own.map((action) => decision(approval, action.id)).find(Boolean) ?? FINDING_STATES.proposed!;
}

// actions.status is free text; these are the values finance-invoice writes.
const ACTION_STATES: Record<string, string> = { proposed: "Waiting for your approval", running: "In progress", done: "Done" };

export const actionState = (action: { id: string; status: string }, approval: Bundle) =>
  (action.status === "proposed" ? decision(approval, action.id) : undefined) ?? ACTION_STATES[action.status] ?? action.status;
