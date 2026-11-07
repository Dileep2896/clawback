import type { Db } from "@bill-fighter/db/client";
import { accounts, actions, approvals, bills, customers, locations, phoneLines, runs } from "@bill-fighter/db/schema";
import { CUSTOMER, INTERNET_CENTS, POTS_LINE_CENTS, STORES, VOICE_LINE_CENTS } from "@bill-fighter/db/seed/customer";
import type { CallPlan } from "./engine.ts";

// Lines and accounts from the real seed data, without the 432,288 usage rows a full seed loads.
const unused = STORES.flatMap((store) => store.pots.filter((pots) => pots.purpose !== "alarm" && pots.calls === 0));

export const SEED_PLAN: CallPlan = {
  accountNumber: "BT-7001",
  cancelLines: unused.map((pots) => pots.number),
  promoAccounts: STORES.filter((store) => store.internetChangeMonth).map((store) => `BC-${store.accountSuffix}`),
};

export const ALARM_LINES = STORES.flatMap((store) => store.pots.filter((pots) => pots.purpose === "alarm").map((pots) => pots.number));

export const APPROVED_AT = new Date("2026-11-07T18:00:00.000Z");

/** What a call needs for its fact sheet: an approved bundle holding the action, and a bill per account. Separate from seedCallData, because some tests must have no bundle. */
export async function seedCallFacts(db: Db, actionId: string, approvedBy: string = CUSTOMER.contactName) {
  const runId = `call-facts-${actionId}`;
  await db.insert(runs).values({ id: runId, customerId: CUSTOMER.id, platform: "local", trigger: "manual", status: "running" });
  await db.insert(approvals).values({ runId, actionIds: [actionId], summary: "The call", status: "approved", channel: "dashboard", approvedBy, approvedAt: APPROVED_AT });
  await db.insert(bills).values(
    STORES.flatMap((store) => [
      { accountId: `${store.id}-telecom`, periodStart: "2026-10-01", periodEnd: "2026-10-31", totalCents: VOICE_LINE_CENTS },
      { accountId: `${store.id}-internet`, periodStart: "2026-10-01", periodEnd: "2026-10-31", totalCents: INTERNET_CENTS },
    ]),
  );
}

/** Inserts what a call reads, plus the call action. */
export async function seedCallData(db: Db, actionId: string, plan?: CallPlan) {
  await db.insert(customers).values(CUSTOMER);
  await db.insert(actions).values({ id: actionId, kind: "call", status: "approved", ...(plan ? { payloadJson: plan } : {}) });
  for (const store of STORES) {
    const telecomId = `${store.id}-telecom`;
    await db.insert(locations).values({ id: store.id, customerId: CUSTOMER.id, name: store.name, address: store.address, city: store.city });
    await db.insert(accounts).values([
      { id: telecomId, locationId: store.id, provider: "baytel", serviceType: "telecom", accountNumber: `BT-${store.accountSuffix}` },
      { id: `${store.id}-internet`, locationId: store.id, provider: "bayconnect", serviceType: "internet", accountNumber: `BC-${store.accountSuffix}` },
    ]);
    await db.insert(phoneLines).values([
      { accountId: telecomId, number: store.voiceNumber, label: "Main line", monthlyCents: VOICE_LINE_CENTS, callsLast12mo: store.voiceCalls, purpose: "voice" },
      ...store.pots.map((pots) => ({ accountId: telecomId, number: pots.number, label: pots.label, monthlyCents: POTS_LINE_CENTS, callsLast12mo: pots.calls, purpose: pots.purpose })),
    ]);
  }
}
