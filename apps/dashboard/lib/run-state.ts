import { RUN_CARD_AGENT } from "@bill-fighter/shared/run-card";

/** A run that ended without finishing its work, such as error or over_budget. Nothing is listening for a decision any more. */
export const isStopped = (status: string | undefined) => status !== undefined && status !== "running" && status !== "success";

export const STOPPED_TEXT = "This run stopped, so nothing can be approved.";

/** What the run itself reported as wrong, for the header. A card an agent marked blocked stays on the board only. */
export const runProblems = (cards: { agent: string; status: string; title: string }[]) =>
  cards.filter((card) => card.agent === RUN_CARD_AGENT && card.status === "blocked").map((card) => card.title);
