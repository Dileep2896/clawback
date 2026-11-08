import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Text ids: data/parsed/ and the seed use readable fixed ids, never database sequences.
const id = () => text("id").primaryKey().default(sql`gen_random_uuid()::text`);
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();
const costUsd = () => numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0);
const confidence = (name: string) => numeric(name, { precision: 4, scale: 3, mode: "number" });
const decimal = (name: string) => numeric(name, { precision: 14, scale: 6, mode: "number" });

export const provider = pgEnum("provider", ["baycurrent", "baytel", "bayconnect", "bayhearth"]);
export const serviceType = pgEnum("service_type", ["electric", "gas", "telecom", "internet"]);
export const phoneLinePurpose = pgEnum("phone_line_purpose", ["unknown", "fax", "alarm", "voice"]);
export const findingStatus = pgEnum("finding_status", ["proposed", "approved", "filed", "won", "rejected"]);
export const actionKind = pgEnum("action_kind", [
  "call",
  "letter",
  "claim",
  "plan_change",
  "cancel",
  "invoice",
  "card_pay",
]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "denied"]);
export const approvalChannel = pgEnum("approval_channel", ["dashboard", "sms", "naive"]);
export const callMode = pgEnum("call_mode", ["sim", "live", "email"]);
// How the owner chose to reach the provider. Call is the default (human, 2026-11-08).
export const contactChannel = pgEnum("contact_channel", ["call", "email"]);
export const ledgerKind = pgEnum("ledger_kind", ["refund", "savings", "fee", "invoice", "card_spend"]);
export const runTrigger = pgEnum("run_trigger", ["email", "schedule", "manual"]);
export const boardCardStatus = pgEnum("board_card_status", ["todo", "doing", "done", "blocked"]);

export const customers = pgTable("customers", {
  id: id(),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull(),
  savingsSharePct: integer("savings_share_pct").notNull().default(30),
});

// Demo accounts for the dashboard. Not a real identity provider: demo:reset clears every row.
export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  company: text("company").notNull(),
  // Stored lowercase, so the unique index is case-insensitive in practice.
  email: text("email").notNull().unique(),
  // scrypt "salt:hash", both base64. Never the password.
  passwordHash: text("password_hash").notNull(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  // True when sign-up made the customer row, so demo:reset deletes it; false when the email matched a seeded customer.
  createdCustomer: boolean("created_customer").notNull().default(false),
  auditRequestedAt: timestamptz("audit_requested_at"),
  createdAt: createdAt(),
});

export const locations = pgTable("locations", {
  id: id(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
});

export const accounts = pgTable("accounts", {
  id: id(),
  locationId: text("location_id").notNull().references(() => locations.id),
  provider: provider("provider").notNull(),
  accountNumber: text("account_number").notNull(),
  serviceType: serviceType("service_type").notNull(),
  rateSchedule: text("rate_schedule"),
  meterNumber: text("meter_number"),
});

export const authorizations = pgTable("authorizations", {
  id: id(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  provider: provider("provider").notNull(),
  formType: text("form_type").notNull(),
  scope: text("scope").notNull(),
  signedBy: text("signed_by").notNull(),
  signedAt: timestamptz("signed_at").notNull(),
  expiresAt: timestamptz("expires_at"),
  pdfPath: text("pdf_path"),
});

export const bills = pgTable("bills", {
  id: id(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  totalCents: integer("total_cents").notNull(),
  pdfPath: text("pdf_path"),
  parsedJson: jsonb("parsed_json"),
  parseConfidence: confidence("parse_confidence"),
});

export const billLines = pgTable("bill_lines", {
  id: id(),
  billId: text("bill_id").notNull().references(() => bills.id),
  description: text("description").notNull(),
  quantity: decimal("quantity"),
  unit: text("unit"),
  // Dollars per unit as printed on the bill: a unit price cannot be whole cents. Amounts stay integer cents.
  rate: decimal("rate"),
  amountCents: integer("amount_cents").notNull(),
  lineType: text("line_type"),
});

export const usageIntervals = pgTable(
  "usage_intervals",
  {
    accountId: text("account_id").notNull().references(() => accounts.id),
    ts: timestamptz("ts").notNull(),
    kwh: decimal("kwh").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.ts] })],
);

export const phoneLines = pgTable("phone_lines", {
  id: id(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  number: text("number").notNull(),
  label: text("label"),
  monthlyCents: integer("monthly_cents").notNull(),
  callsLast12mo: integer("calls_last_12mo").notNull(),
  purpose: phoneLinePurpose("purpose").notNull().default("unknown"),
});

export const findings = pgTable("findings", {
  id: id(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  // Nullable: a rule may report across several accounts.
  accountId: text("account_id").references(() => accounts.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  evidenceJson: jsonb("evidence_json").notNull(),
  refundCents: integer("refund_cents").notNull().default(0),
  annualSavingsCents: integer("annual_savings_cents").notNull().default(0),
  confidence: confidence("confidence").notNull(),
  status: findingStatus("status").notNull().default("proposed"),
});

export const actions = pgTable("actions", {
  id: id(),
  // Nullable: invoices and card payments belong to no single finding.
  findingId: text("finding_id").references(() => findings.id),
  kind: actionKind("kind").notNull(),
  payloadJson: jsonb("payload_json"),
  status: text("status").notNull(),
  // Defaults to true so a forgotten value fails closed: nothing changes without approval.
  requiresApproval: boolean("requires_approval").notNull().default(true),
});

export const runs = pgTable("runs", {
  id: id(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  platform: text("platform").notNull(),
  trigger: runTrigger("trigger").notNull(),
  // Same inbound email delivered twice starts one run, even when the two webhooks race.
  dedupeKey: text("dedupe_key").unique(),
  startedAt: timestamptz("started_at").notNull().defaultNow(),
  finishedAt: timestamptz("finished_at"),
  status: text("status").notNull(),
  costUsd: costUsd(),
  // Set only by scripts/replay.ts: { recordedAt, speed, startedAt }. Non-null means this run is a recording, and the dashboard labels it so.
  replay: jsonb("replay"),
});

export const approvals = pgTable("approvals", {
  id: id(),
  // One bundle per run.
  runId: text("run_id").notNull().unique().references(() => runs.id),
  // Postgres cannot enforce foreign keys on array elements, so platform-db-adapters validates these.
  actionIds: text("action_ids").array().notNull(),
  summary: text("summary").notNull(),
  status: approvalStatus("status").notNull().default("pending"),
  channel: approvalChannel("channel"),
  contact: contactChannel("contact").notNull().default("call"),
  approvedBy: text("approved_by"),
  approvedAt: timestamptz("approved_at"),
});

export const calls = pgTable("calls", {
  id: id(),
  actionId: text("action_id").notNull().references(() => actions.id),
  mode: callMode("mode").notNull(),
  toNumber: text("to_number").notNull(),
  startedAt: timestamptz("started_at").notNull().defaultNow(),
  endedAt: timestamptz("ended_at"),
  recordingUrl: text("recording_url"),
  transcriptJson: jsonb("transcript_json"),
  outcomeJson: jsonb("outcome_json"),
});

export const ledger = pgTable(
  "ledger",
  {
    id: id(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    // Nullable: card spend and invoices belong to no finding. NULLs stay distinct under the unique below.
    findingId: text("finding_id").references(() => findings.id),
    kind: ledgerKind("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    externalId: text("external_id"),
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.findingId, t.kind)],
);

export const boardCards = pgTable("board_cards", {
  id: id(),
  runId: text("run_id").notNull().references(() => runs.id),
  agent: text("agent").notNull(),
  title: text("title").notNull(),
  status: boardCardStatus("status").notNull().default("todo"),
  updatedAt: timestamptz("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    // Nullable: an audit row must never be lost for lack of a run.
    runId: text("run_id").references(() => runs.id),
    agent: text("agent").notNull(),
    tool: text("tool").notNull(),
    inputJson: jsonb("input_json"),
    outputJson: jsonb("output_json"),
    costUsd: costUsd(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.runId, t.createdAt)],
);

export const smsMessages = pgTable("sms_messages", {
  id: id(),
  direction: text("direction").notNull(),
  to: text("to").notNull(),
  from: text("from").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const scheduledChecks = pgTable(
  "scheduled_checks",
  {
    id: id(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    runAt: timestamptz("run_at").notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.customerId, t.runAt)],
);
