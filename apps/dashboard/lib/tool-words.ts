// Each agent tool as a step in the owner's words, for the timeline and the audit log. Audit rows carry no tool input or
// outcome, and denied, refused and failed attempts are logged too, so the words name the step and never claim it worked.
export const TOOL_WORDS: Record<string, string> = {
  attach_evidence: "Attach the evidence to the findings",
  board_update: "Update the plan",
  call_provider: "Call the provider",
  cancel_service: "Cancel an unused line",
  card_pay: "Charge the card on file",
  change_rate_plan: "Move an account to a cheaper rate plan",
  create_invoice: "Create Clawback's invoice",
  download_bills: "Download the bills",
  download_usage: "Download the meter readings",
  draft_letter: "Draft the dispute letter",
  get_customer: "Look up the business",
  parse_bill: "Read the bills",
  parse_inbound_email: "Read the bill email",
  portal_login: "Log in to the provider's portal",
  price_usage: "Price the usage on every rate plan",
  record_savings: "Record the money in the ledger",
  request_approval: "Ask the owner to approve",
  run_audit: "Check every bill for mistakes",
  schedule_check: "Schedule next month's check",
  send_email: "Send an email",
  send_sms: "Text the owner",
  store_bill: "Save the bills",
  store_usage: "Save the meter readings",
  submit_claim: "File the refund claim",
};

/** "portal_login" → "Log in to the provider's portal". A tool with no words yet reads as a sentence, never a raw name. */
export const toolWords = (tool: string) => TOOL_WORDS[tool] ?? `${tool.charAt(0).toUpperCase()}${tool.slice(1).replaceAll("_", " ")}`;
