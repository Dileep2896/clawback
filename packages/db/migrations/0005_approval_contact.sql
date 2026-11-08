CREATE TYPE "public"."contact_channel" AS ENUM('call', 'email');--> statement-breakpoint
ALTER TYPE "public"."call_mode" ADD VALUE 'email';--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "contact" "contact_channel" DEFAULT 'call' NOT NULL;