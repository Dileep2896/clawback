import { accounts, billLines, bills, customers, locations, users } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { withTestDb } from "@bill-fighter/db/test-db";
import type { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { clearSignups } from "../../../scripts/demo-reset.ts";
import { createUser, logIn, providerOf, saveParsedBill } from "./accounts.ts";

vi.setConfig({ testTimeout: 60_000 });

const LINDA = { name: "Linda Park", company: "Golden Gate Noodle Co.", email: CUSTOMER.contactEmail, password: "noodles-2026" };
const NEW = { name: "Sam Lee", company: "Mission Dumplings", email: "sam@missiondumplings.example", password: "dumplings-2026" };

const BILL: ParsedBill = {
  accountNumber: "BE-9001",
  serviceAddress: "10 Valencia St, San Francisco, CA",
  providerName: "BayCurrent Electric",
  serviceType: "electric",
  meterNumber: "M1",
  multiplier: 1,
  rateSchedule: "B-19",
  planCode: null,
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  kwhByTouPeriod: [],
  maxKw: null,
  lineItems: [{ description: "Energy", quantity: 100, unit: "kWh", rate: 0.2, amountCents: 2000, lineType: "energy" }],
  totalCents: 2000,
};

describe("sign-up, log in, uploads and the reset", () => {
  it("links the seeded email, creates a customer for a new one, and demo:reset clears only the sign-ups", () =>
    withTestDb("signup", async (db) => {
      await db.insert(customers).values(CUSTOMER);

      const linda = await createUser(db, LINDA);
      expect(linda).toMatchObject({ customerId: CUSTOMER.id, createdCustomer: false });
      expect(await createUser(db, { ...LINDA, email: LINDA.email.toUpperCase().toLowerCase() })).toBe("taken");

      const sam = await createUser(db, NEW);
      if (sam === "taken") throw new Error("unexpected");
      expect(sam.customerId).not.toBe(CUSTOMER.id);
      expect(sam.createdCustomer).toBe(true);
      expect(sam.passwordHash).not.toContain(NEW.password);

      expect(await logIn(db, " SAM@missiondumplings.example ", NEW.password)).toMatchObject({ id: sam.id });
      expect(await logIn(db, NEW.email, "wrong-password")).toBeNull();
      expect(await logIn(db, "nobody@example.com", NEW.password)).toBeNull();

      // A new customer's upload files a location, account and bill; the same bill again is on file.
      const saved = await saveParsedBill(db, sam.customerId, BILL, "/tmp/x.pdf");
      expect(saved.status).toBe("saved");
      expect(await saveParsedBill(db, sam.customerId, BILL, "/tmp/x.pdf")).toMatchObject({ status: "on_file" });
      expect(await db.select().from(billLines)).toHaveLength(1);

      // The demo customer's rows are the rehearsed run's input: an upload never adds to them.
      expect(await saveParsedBill(db, CUSTOMER.id, BILL, "/tmp/x.pdf")).toMatchObject({ status: "needs_review" });
      expect(await saveParsedBill(db, sam.customerId, { ...BILL, providerName: "PG&E" }, "/tmp/x.pdf")).toMatchObject({ status: "needs_review" });

      expect(await clearSignups(db.$client)).toEqual([sam.customerId]);
      expect(await db.select().from(users)).toHaveLength(0);
      expect((await db.select().from(customers)).map((c) => c.id)).toEqual([CUSTOMER.id]);
      expect(await db.select().from(locations).where(eq(locations.customerId, sam.customerId))).toHaveLength(0);
      expect([await db.select().from(accounts), await db.select().from(bills), await db.select().from(billLines)].map((rows) => rows.length)).toEqual([0, 0, 0]);
    }));
});

describe("providerOf", () => {
  it("reads our providers from the name printed on the bill", () => {
    expect(providerOf("BayCurrent Electric")).toBe("baycurrent");
    expect(providerOf("BayTel Business")).toBe("baytel");
    expect(providerOf("Bay Connect")).toBe("bayconnect");
    expect(providerOf("BayHearth Energy")).toBe("bayhearth");
    expect(providerOf("PG&E")).toBeNull();
  });
});
