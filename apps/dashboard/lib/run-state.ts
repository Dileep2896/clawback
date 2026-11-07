import { RUN_CARD_AGENT } from "@bill-fighter/shared/run-card";

/** A run that ended without finishing its work, such as error or over_budget. Nothing is listening for a decision any more. */
export const isStopped = (status: string | undefined) => status !== undefined && status !== "running" && status !== "success";

export const STOPPED_TEXT = "This run stopped, so nothing can be approved.";

/** What the run itself reported as wrong, for the header. A card an agent marked blocked stays on the board only. */
export const runProblems = (cards: { agent: string; status: string; title: string }[]) =>
  cards.filter((card) => card.agent === RUN_CARD_AGENT && card.status === "blocked").map((card) => card.title);

// runs.status is free text such as running, success or over_budget.
export const statusLabel = (status: string) => {
  const words = status.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const FINDING_STATES: Record<string, string> = {
  proposed: "Waiting for your approval",
  approved: "Approved, agents at work",
  filed: "Filed with the provider",
  won: "Won",
  rejected: "Turned down",
};

/** A finding no action points at was found and left alone, such as an expired promo: say so rather than imply work on it. */
export const findingState = (finding: { id: string; status: string }, actions: { findingId: string | null }[]) =>
  actions.some((action) => action.findingId === finding.id) ? (FINDING_STATES[finding.status] ?? finding.status) : "Found, not acted on";
