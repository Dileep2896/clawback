import { db as defaultDb } from "@bill-fighter/db/client";
import { smsMessages } from "@bill-fighter/db/schema";
import { asc } from "drizzle-orm";
import type { Identity, Sms } from "../types.ts";
import defaultIdentity from "./identity.ts";
import type { Db } from "./temp-db.ts";

// Simulated: a row for the dashboard's phone panel and a console line. Nothing leaves the machine.
export const createSms = (db: Db, identity: Identity): Sms => ({
  async send({ to, body }) {
    const { phone } = await identity.get();
    const rows = await db.insert(smsMessages).values({ direction: "outbound", to, from: phone, body }).returning();
    console.log(`[sms] to ${to}: ${body}`);
    return { id: rows[0]!.id };
  },
  async receive({ from, body }) {
    const { phone } = await identity.get();
    const rows = await db.insert(smsMessages).values({ direction: "inbound", to: phone, from, body }).returning();
    return rows[0]!;
  },
  list: () => db.select().from(smsMessages).orderBy(asc(smsMessages.createdAt)),
});

export default createSms(defaultDb, defaultIdentity);
