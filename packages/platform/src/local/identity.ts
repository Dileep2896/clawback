import type { Identity } from "../types.ts";

export const createIdentity = (env: Record<string, string | undefined> = process.env): Identity => ({
  get: async () => ({
    companyName: env.COMPANY_NAME || "Clawback",
    email: env.COMPANY_EMAIL || "bills@billfighter.local",
    phone: env.COMPANY_PHONE || "+15550002222",
  }),
});

export default createIdentity();
