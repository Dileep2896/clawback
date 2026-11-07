import assert from "node:assert/strict";
import { createIdentity, inboxAddress } from "./identity.ts";

/** Live and read-only (free): the persona and its bills@ inbox as naïve holds them. */
export default async function check() {
  const { companyName, email, phone } = await createIdentity().get();
  assert.ok(companyName, "the naïve persona has no name");
  assert.equal(email, await inboxAddress(process.env, "NAIVE_INBOX_ID"));
  assert.match(email, /^bills@/, "NAIVE_INBOX_ID is not the bills@ inbox");
  assert.equal(phone, process.env.COMPANY_PHONE || "+15550002222");
}
