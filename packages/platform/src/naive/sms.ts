import { type Db, db as defaultDb } from "@bill-fighter/db/client";
import localIdentity from "../local/identity.ts";
import { createSms as createLocalSms } from "../local/sms.ts";
import type { Identity, Sms } from "../types.ts";

/**
 * naïve answers every text send with 501 feature_not_configured, so send refuses without calling it and never fakes a
 * pass. We hold no naïve number (human's decision, 2026-11-07), so whether an inbound text wakes an agent was not
 * tested: Saturday approval is the emailed request plus the dashboard tap. receive and list stay the local rows, so the
 * dashboard's phone panel still works.
 */
export const SMS_NOT_AVAILABLE = "Sms send is not available on naïve (501 feature_not_configured): approval goes by email and the dashboard tap";

export const createSms = (db: Db, identity: Identity): Sms => ({
  ...createLocalSms(db, identity),
  send: async () => {
    throw new Error(SMS_NOT_AVAILABLE);
  },
});

// The local identity: phone is COMPANY_PHONE on both platforms, and receive should not need the network.
export default createSms(defaultDb, localIdentity);
