import type { Db } from "@bill-fighter/db/client";
import { accounts, billLines, bills, customers, locations, runs, users } from "@bill-fighter/db/schema";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { Provider } from "@bill-fighter/shared/fixtures";
import type { ParsedBill } from "@bill-fighter/shared/parsed-bill";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./auth.ts";

export const SignUp = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  company: z.string().trim().min(1, "Enter your company").max(160),
  email: z.email("Enter a valid email").trim().toLowerCase().max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});
export type SignUp = z.infer<typeof SignUp>;

export type User = typeof users.$inferSelect;

/** The seeded customer: its portal logins are already in the vault, and its run is the rehearsed one. */
export const isDemoCustomer = (customerId: string) => customerId === CUSTOMER.id;

/**
 * An email that matches a customer's contact email links to that customer, which is how Linda Park's sign-up reaches the seeded
 * Golden Gate Noodle Co. Any other email gets a new customer of its own, which demo:reset deletes.
 */
export async function createUser(db: Db, input: SignUp): Promise<User | "taken"> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
      if (taken) return "taken";
      const [existing] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.contactEmail, input.email));
      const customerId =
        existing?.id ??
        (await tx.insert(customers).values({ name: input.company, contactName: input.name, contactEmail: input.email, contactPhone: "" }).returning({ id: customers.id }))[0]!.id;
      const [user] = await tx
        .insert(users)
        .values({ name: input.name, company: input.company, email: input.email, passwordHash, customerId, createdCustomer: !existing })
        .onConflictDoNothing({ target: users.email })
        .returning();
      // A racing sign-up took the email: throwing rolls back the customer made above, which demo:reset could not find through users.
      if (!user) throw new EmailTaken();
      return user;
    });
  } catch (error) {
    if (error instanceof EmailTaken) return "taken";
    throw error;
  }
}

class EmailTaken extends Error {}

/** Holds a transaction-scoped Postgres lock, so racing requests for the same key take turns. */
const lock = (tx: Pick<Db, "execute">, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);

/**
 * Starts the customer's first run once. The lock makes two tabs take turns: the second sees the run the first started, because
 * start() returns only after the webhook has committed the run row. Returns null when a run already exists.
 */
export async function startFirstRun<T>(db: Db, customerId: string, start: () => Promise<T>): Promise<T | null> {
  return db.transaction(async (tx) => {
    await lock(tx, `start-audit:${customerId}`);
    const [existing] = await tx.select({ id: runs.id }).from(runs).where(eq(runs.customerId, customerId)).orderBy(desc(runs.startedAt)).limit(1);
    return existing ? null : start();
  });
}

// Hashes even for an unknown email, so the response time does not reveal which emails have accounts.
const DUMMY_HASH = hashPassword("not-a-real-password");

export async function logIn(db: Db, email: string, password: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
  return user && ok ? user : null;
}

export async function findUser(db: Db, id: string): Promise<User | null> {
  return (await db.select().from(users).where(eq(users.id, id)))[0] ?? null;
}

/** Free-text provider name on the bill to our provider, by its brand word ("BayCurrent Electric" is baycurrent). */
export function providerOf(name: string): Provider | null {
  const squashed = name.toLowerCase().replace(/[^a-z]/g, "");
  return Provider.options.find((provider) => squashed.includes(provider)) ?? null;
}

export type SavedBill = { status: "saved" | "on_file"; billId: string } | { status: "needs_review"; reason: string };

/** Files a parsed bill under the customer's location and account, creating them when the bill is the first one seen for them. */
export async function saveParsedBill(db: Db, customerId: string, bill: ParsedBill, pdfPath: string): Promise<SavedBill> {
  const provider = providerOf(bill.providerName);
  if (!provider) return { status: "needs_review", reason: `We do not work with ${bill.providerName} yet` };

  return db.transaction(async (tx) => {
    // Racing uploads take turns: one account has one owner, a bill period is filed once, an address is one location.
    await lock(tx, `upload:${customerId}`);
    await lock(tx, `account:${provider}:${bill.accountNumber}`);
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(locations, eq(accounts.locationId, locations.id))
      .where(and(eq(locations.customerId, customerId), eq(accounts.provider, provider), eq(accounts.accountNumber, bill.accountNumber)));

    // The demo customer's rows are the rehearsed run's input: an upload may match them but never add to them.
    const locked = isDemoCustomer(customerId);
    let accountId = account?.id;
    if (!accountId && locked) return { status: "needs_review" as const, reason: "This account is not one of the demo customer's accounts" };
    if (!accountId) {
      // One provider account has one owner. A second customer filing it makes Intake find two customers and stop the demo run.
      const [owned] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.provider, provider), eq(accounts.accountNumber, bill.accountNumber)))
        .limit(1);
      if (owned) return { status: "needs_review" as const, reason: "This account is already linked to another Clawback customer" };
      const address = bill.serviceAddress ?? "Address not on the bill";
      // Electricity and gas at one address are one location.
      const [known] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.customerId, customerId), sql`lower(trim(${locations.address})) = ${address.trim().toLowerCase()}`))
        .limit(1);
      const parts = address.split(",").map((part) => part.trim());
      const locationId =
        known?.id ??
        (await tx.insert(locations).values({ customerId, name: parts[0] || address, address, city: parts[1] ?? "" }).returning({ id: locations.id }))[0]!.id;
      const [created] = await tx
        .insert(accounts)
        .values({ locationId, provider, accountNumber: bill.accountNumber, serviceType: bill.serviceType, rateSchedule: bill.rateSchedule, meterNumber: bill.meterNumber })
        .returning({ id: accounts.id });
      accountId = created!.id;
    }

    // The seeded customer already has every seed bill: uploading one again must not duplicate it.
    const [same] = await tx
      .select({ id: bills.id })
      .from(bills)
      .where(and(eq(bills.accountId, accountId), eq(bills.periodStart, bill.periodStart), eq(bills.periodEnd, bill.periodEnd)));
    if (same) return { status: "on_file" as const, billId: same.id };
    if (locked) return { status: "needs_review" as const, reason: "This bill period is not in the demo data" };

    const [saved] = await tx
      .insert(bills)
      .values({ accountId, periodStart: bill.periodStart, periodEnd: bill.periodEnd, totalCents: bill.totalCents, pdfPath, parsedJson: bill })
      .returning({ id: bills.id });
    if (bill.lineItems.length > 0) {
      await tx.insert(billLines).values(bill.lineItems.map((line) => ({ billId: saved!.id, ...line })));
    }
    return { status: "saved" as const, billId: saved!.id };
  });
}
