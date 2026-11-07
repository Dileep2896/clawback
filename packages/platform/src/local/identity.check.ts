import assert from "node:assert/strict";
import { createIdentity } from "./identity.ts";

export default async function check() {
  const values = { COMPANY_NAME: "Acme", COMPANY_EMAIL: "a@acme.local", COMPANY_PHONE: "+15550009999" };
  assert.deepEqual(await createIdentity(values).get(), {
    companyName: "Acme",
    email: "a@acme.local",
    phone: "+15550009999",
  });
  assert.deepEqual(await createIdentity({}).get(), {
    companyName: "Bill Fighter",
    email: "bills@billfighter.local",
    phone: "+15550002222",
  });
}
