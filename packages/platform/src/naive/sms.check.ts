import assert from "node:assert/strict";
import { withTestDb } from "@bill-fighter/db/test-db";
import { createIdentity } from "../local/identity.ts";
import { createSms, SMS_NOT_AVAILABLE } from "./sms.ts";

/** Proves send is refused and receive/list still work, then reports send as N/A: never a PASS for a send that cannot happen. */
export default async function check() {
  await withTestDb("naive_sms", async (db) => {
    const sms = createSms(db, createIdentity({ COMPANY_PHONE: "+15550002222" }));
    await assert.rejects(sms.send({ to: "+15550001111", body: "Approve the bundle?" }), { message: SMS_NOT_AVAILABLE });

    await sms.receive({ from: "+15550001111", body: "YES" });
    const thread = await sms.list();
    assert.deepEqual(
      thread.map(({ direction, to, from, body }) => ({ direction, to, from, body })),
      [{ direction: "inbound", to: "+15550002222", from: "+15550001111", body: "YES" }],
      "a refused send left a row, or receive did not record",
    );
  });
  return { notAvailable: "Sms send answers 501 feature_not_configured; receive and list work" };
}
