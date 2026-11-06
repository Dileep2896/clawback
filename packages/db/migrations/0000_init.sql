CREATE TYPE "public"."action_kind" AS ENUM('call', 'letter', 'claim', 'plan_change', 'cancel', 'invoice', 'card_pay');--> statement-breakpoint
CREATE TYPE "public"."approval_channel" AS ENUM('dashboard', 'sms', 'naive');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."board_card_status" AS ENUM('todo', 'doing', 'done', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."call_mode" AS ENUM('sim', 'live');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('proposed', 'approved', 'filed', 'won', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('refund', 'savings', 'fee', 'invoice', 'card_spend');--> statement-breakpoint
CREATE TYPE "public"."phone_line_purpose" AS ENUM('unknown', 'fax', 'alarm', 'voice');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('pacific_power', 'baytel', 'bayconnect', 'bayhearth');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('email', 'schedule', 'manual');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('electric', 'gas', 'telecom', 'internet');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"location_id" text NOT NULL,
	"provider" "provider" NOT NULL,
	"account_number" text NOT NULL,
	"service_type" "service_type" NOT NULL,
	"rate_schedule" text,
	"meter_number" text
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"finding_id" text,
	"kind" "action_kind" NOT NULL,
	"payload_json" jsonb,
	"status" text NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"run_id" text NOT NULL,
	"action_ids" text[] NOT NULL,
	"summary" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"channel" "approval_channel",
	"approved_by" text,
	"approved_at" timestamp with time zone,
	CONSTRAINT "approvals_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"run_id" text,
	"agent" text NOT NULL,
	"tool" text NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorizations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"customer_id" text NOT NULL,
	"provider" "provider" NOT NULL,
	"form_type" text NOT NULL,
	"scope" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"pdf_path" text
);
--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"bill_id" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 6),
	"unit" text,
	"rate" numeric(14, 6),
	"amount_cents" integer NOT NULL,
	"line_type" text
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"account_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_cents" integer NOT NULL,
	"pdf_path" text,
	"parsed_json" jsonb,
	"parse_confidence" numeric(4, 3)
);
--> statement-breakpoint
CREATE TABLE "board_cards" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"run_id" text NOT NULL,
	"agent" text NOT NULL,
	"title" text NOT NULL,
	"status" "board_card_status" DEFAULT 'todo' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"action_id" text NOT NULL,
	"mode" "call_mode" NOT NULL,
	"to_number" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"recording_url" text,
	"transcript_json" jsonb,
	"outcome_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"savings_share_pct" integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"customer_id" text NOT NULL,
	"account_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"refund_cents" integer DEFAULT 0 NOT NULL,
	"annual_savings_cents" integer DEFAULT 0 NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"status" "finding_status" DEFAULT 'proposed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"customer_id" text NOT NULL,
	"finding_id" text,
	"kind" "ledger_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_finding_id_kind_unique" UNIQUE("finding_id","kind")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"customer_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"account_id" text NOT NULL,
	"number" text NOT NULL,
	"label" text,
	"monthly_cents" integer NOT NULL,
	"calls_last_12mo" integer NOT NULL,
	"purpose" "phone_line_purpose" DEFAULT 'unknown' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"customer_id" text NOT NULL,
	"platform" text NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"dedupe_key" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	CONSTRAINT "runs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "scheduled_checks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"customer_id" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_checks_customer_id_run_at_unique" UNIQUE("customer_id","run_at")
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"direction" text NOT NULL,
	"to" text NOT NULL,
	"from" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_intervals" (
	"account_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"kwh" numeric(14, 6) NOT NULL,
	CONSTRAINT "usage_intervals_account_id_ts_pk" PRIMARY KEY("account_id","ts")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_cards" ADD CONSTRAINT "board_cards_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_lines" ADD CONSTRAINT "phone_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_checks" ADD CONSTRAINT "scheduled_checks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_intervals" ADD CONSTRAINT "usage_intervals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_run_id_created_at_index" ON "audit_log" USING btree ("run_id","created_at");