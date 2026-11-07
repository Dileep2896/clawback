import assert from "node:assert/strict";
import { withTestDb } from "@bill-fighter/db/test-db";
import { createIdentity } from "./identity.ts";
import { createSms } from "./sms.ts";

export default async function check() {
  await withTestDb("sms", async (db) => {
    const sms = createSms(db, createIdentity({ COMPANY_PHONE: "+15550002222" }));

    const { id } = await sms.send({ to: "+15550001111", body: "Approve the bundle?" });
    const reply = await sms.receive({ from: "+15550001111", body: "YES" });

    const thread = await sms.list();
    assert.deepEqual(
      thread.map(({ direction, to, from, body }) => ({ direction, to, from, body })),
      [
        { direction: "outbound", to: "+15550001111", from: "+15550002222", body: "Approve the bundle?" },
        { direction: "inbound", to: "+15550002222", from: "+15550001111", body: "YES" },
      ],
    );
    assert.deepEqual(thread.map((message) => message.id), [id, reply.id]);
  });
}
