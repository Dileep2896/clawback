// The local mock card (hard cap NAIVE_CARD_CAP_USD, writes card_spend), on purpose: naïve card issuing answers
// 501 feature_not_configured, and issuing needs billing:write, which our key does not have. check-platform reports the
// naïve card as N/A, never as a pass.
export { default } from "../local/card.ts";
