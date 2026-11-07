import { accounts, billLines, bills, customers, locations, runs, users } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { withTestDb } from "@bill-fighter/db/test-db";
import type { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { clearSignups } from "../../../scripts/demo-reset.ts";
import { createUser, logIn, providerOf, saveParsedBill, startFirstRun } from "./accounts.ts";

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

      // An account another customer already has is never filed twice: Intake would find two customers and stop the run.
      const other = await createUser(db, { ...NEW, email: "other@example.com" });
      if (other === "taken") throw new Error("unexpected");
      expect(await saveParsedBill(db, other.customerId, BILL, "/tmp/x.pdf")).toMatchObject({ status: "needs_review" });

      // The demo customer's rows are the rehearsed run's input: an upload never adds to them.
      expect(await saveParsedBill(db, CUSTOMER.id, BILL, "/tmp/x.pdf")).toMatchObject({ status: "needs_review" });
      expect(await saveParsedBill(db, sam.customerId, { ...BILL, providerName: "PG&E" }, "/tmp/x.pdf")).toMatchObject({ status: "needs_review" });

      expect((await clearSignups(db.$client)).sort()).toEqual([sam.customerId, other.customerId].sort());
      expect(await db.select().from(users)).toHaveLength(0);
      expect((await db.select().from(customers)).map((c) => c.id)).toEqual([CUSTOMER.id]);
      expect(await db.select().from(locations).where(eq(locations.customerId, sam.customerId))).toHaveLength(0);
      expect([await db.select().from(accounts), await db.select().from(bills), await db.select().from(billLines)].map((rows) => rows.length)).toEqual([0, 0, 0]);
    }));
});

describe("racing requests", () => {
  const signUp = async (db: Parameters<typeof createUser>[0], email: string) => {
    const user = await createUser(db, { ...NEW, email });
    if (user === "taken") throw new Error("unexpected");
    return user;
  };

  it("two sign-ups with one email make one user and no orphan customer", () =>
    withTestDb("signup_race", async (db) => {
      const results = await Promise.all([createUser(db, NEW), createUser(db, NEW), createUser(db, NEW)]);
      expect(results.filter((result) => result === "taken")).toHaveLength(2);
      expect(await db.select().from(users)).toHaveLength(1);
      expect(await db.select().from(customers)).toHaveLength(1);
    }));

  it("two customers uploading one account at once file it under one of them", () =>
    withTestDb("upload_owner_race", async (db) => {
      const [a, b] = [await signUp(db, "a@example.com"), await signUp(db, "b@example.com")];
      const results = await Promise.all([saveParsedBill(db, a.customerId, BILL, "/tmp/a.pdf"), saveParsedBill(db, b.customerId, BILL, "/tmp/b.pdf")]);
      expect(results.map((result) => result.status).sort()).toEqual(["needs_review", "saved"]);
      expect([await db.select().from(accounts), await db.select().from(bills), await db.select().from(locations)].map((rows) => rows.length)).toEqual([1, 1, 1]);
    }));

  it("one bill uploaded twice at once is filed once", () =>
    withTestDb("upload_period_race", async (db) => {
      const sam = await signUp(db, NEW.email);
      const results = await Promise.all([1, 2, 3].map(() => saveParsedBill(db, sam.customerId, BILL, "/tmp/x.pdf")));
      expect(results.map((result) => result.status).sort()).toEqual(["on_file", "on_file", "saved"]);
      expect([await db.select().from(accounts), await db.select().from(bills), await db.select().from(billLines)].map((rows) => rows.length)).toEqual([1, 1, 1]);
    }));

  it("electricity and gas at one address share a location, even uploaded at once", () =>
    withTestDb("upload_location", async (db) => {
      const sam = await signUp(db, NEW.email);
      const gas: ParsedBill = { ...BILL, accountNumber: "BH-9002", providerName: "BayHearth Energy", serviceType: "gas", serviceAddress: "10 valencia st, San Francisco, CA " };
      const elsewhere: ParsedBill = { ...BILL, accountNumber: "BE-9003", serviceAddress: "99 Mission St, San Francisco, CA" };
      const results = await Promise.all([saveParsedBill(db, sam.customerId, BILL, "/tmp/e.pdf"), saveParsedBill(db, sam.customerId, gas, "/tmp/g.pdf")]);
      expect(results.map((result) => result.status)).toEqual(["saved", "saved"]);
      expect(await db.select().from(locations)).toHaveLength(1);
      expect(await saveParsedBill(db, sam.customerId, elsewhere, "/tmp/m.pdf")).toMatchObject({ status: "saved" });
      expect(await db.select().from(locations)).toHaveLength(2);
      expect(await db.select().from(accounts)).toHaveLength(3);
    }));

  it("two tabs starting the audit at once start one run", () =>
    withTestDb("start_race", async (db) => {
      await db.insert(customers).values(CUSTOMER);
      let started = 0;
      // Like the webhook: the run row is committed before the reply comes back.
      const start = async () => {
        started += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        await db.insert(runs).values({ customerId: CUSTOMER.id, platform: "local", trigger: "email", status: "running" });
        return "started";
      };
      const results = await Promise.all([1, 2, 3].map(() => startFirstRun(db, CUSTOMER.id, start)));
      expect(results.filter(Boolean)).toEqual(["started"]);
      expect(started).toBe(1);
      expect(await db.select().from(runs)).toHaveLength(1);
      expect(await startFirstRun(db, CUSTOMER.id, start)).toBeNull();
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
