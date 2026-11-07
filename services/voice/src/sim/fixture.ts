import type { Db } from "@bill-fighter/db/client";
import { accounts, actions, customers, locations, phoneLines } from "@bill-fighter/db/schema";
import { CUSTOMER, POTS_LINE_CENTS, STORES, VOICE_LINE_CENTS } from "@bill-fighter/db/seed/customer";
import type { CallPlan } from "./engine.ts";

// Lines and accounts from the real seed data, without the 432,288 usage rows a full seed loads.
const unused = STORES.flatMap((store) => store.pots.filter((pots) => pots.purpose !== "alarm" && pots.calls === 0));

export const SEED_PLAN: CallPlan = {
  accountNumber: "BT-7001",
  cancelLines: unused.map((pots) => pots.number),
  promoAccounts: STORES.filter((store) => store.internetChangeMonth).map((store) => `BC-${store.accountSuffix}`),
};

export const ALARM_LINES = STORES.flatMap((store) => store.pots.filter((pots) => pots.purpose === "alarm").map((pots) => pots.number));

/** Inserts what a call reads, plus the call action. */
export async function seedCallData(db: Db, actionId: string) {
  await db.insert(customers).values(CUSTOMER);
  await db.insert(actions).values({ id: actionId, kind: "call", status: "approved" });
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
