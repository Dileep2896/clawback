// What each agent tool did, in the owner's words, for the timeline and the audit log. Audit rows carry no tool input,
// so the words name no provider or amount they cannot know.
export const TOOL_WORDS: Record<string, string> = {
  attach_evidence: "Attached the evidence to the findings",
  board_update: "Updated the plan",
  call_provider: "Called the provider",
  cancel_service: "Cancelled an unused line",
  card_pay: "Charged the card on file",
  change_rate_plan: "Moved an account to a cheaper rate plan",
  create_invoice: "Sent Clawback's invoice",
  download_bills: "Downloaded the bills",
  download_usage: "Downloaded the meter readings",
  draft_letter: "Drafted the dispute letter",
  get_customer: "Looked up the business",
  parse_bill: "Read the bills",
  parse_inbound_email: "Read the bill email",
  portal_login: "Logged in to the provider's portal",
  price_usage: "Priced the usage on every rate plan",
  record_savings: "Recorded the money in the ledger",
  request_approval: "Asked the owner to approve",
  run_audit: "Checked every bill for mistakes",
  schedule_check: "Scheduled next month's check",
  send_email: "Sent an email",
  send_sms: "Texted the owner",
  store_bill: "Saved the bills",
  store_usage: "Saved the meter readings",
  submit_claim: "Filed the refund claim",
};

/** "portal_login" → "Logged in to the provider's portal". A tool with no words yet reads as a sentence, never a raw name. */
export const toolWords = (tool: string) => TOOL_WORDS[tool] ?? `${tool.charAt(0).toUpperCase()}${tool.slice(1).replaceAll("_", " ")}`;
