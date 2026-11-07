import type { Db } from "@bill-fighter/db/client";
import { accounts, approvals, bills, customers, locations } from "@bill-fighter/db/schema";
import { and, arrayContains, desc, eq, inArray } from "drizzle-orm";

type AccountFact = { accountNumber: string; address: string; latestBill: { amount: string; periodEnd: string } | null };

export type CallFacts = {
  company: string;
  holder: string;
  approvedOn: string;
  // False when a process, such as run-local's auto approval, decided the bundle rather than the customer's contact.
  byOwner: boolean;
  // The plan's own account first.
  accounts: AccountFact[];
};

// The customer's own time zone, so the date said is the date they approved.
const longDate = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Los_Angeles" });
const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * What a call may say, read only from the database and only after checkPlan. Throws if no approved bundle holds this action, so no call of either kind starts.
 * The lines' own account numbers come from checkPlan, which has already refused alarm lines.
 */
export async function callFacts(db: Db, actionId: string, plan: { accountNumber: string; promoAccounts: string[] }, planned: { accountNumber: string }[]): Promise<CallFacts> {
  const [approval] = await db
    .select({ approvedBy: approvals.approvedBy, approvedAt: approvals.approvedAt })
    .from(approvals)
    .where(and(eq(approvals.status, "approved"), arrayContains(approvals.actionIds, [actionId])));
  if (!approval?.approvedBy || !approval.approvedAt) throw new Error(`Action ${actionId} is in no approved bundle, so no call starts`);

  const numbers = [...new Set([plan.accountNumber, ...planned.map((line) => line.accountNumber), ...plan.promoAccounts])];
  const rows = await db
    .select({ id: accounts.id, accountNumber: accounts.accountNumber, address: locations.address, customerId: customers.id, company: customers.name, holder: customers.contactName })
    .from(accounts)
    .innerJoin(locations, eq(accounts.locationId, locations.id))
    .innerJoin(customers, eq(locations.customerId, customers.id))
    .where(inArray(accounts.accountNumber, numbers));
  const main = rows.find((row) => row.accountNumber === plan.accountNumber);
  if (!main) throw new Error(`Account ${plan.accountNumber} is not on file`);
  // Account numbers are matched across customers, so another customer's account never reaches the sheet.
  const own = rows.filter((row) => row.customerId === main.customerId);

  const billRows = await db
    .select({ accountId: bills.accountId, totalCents: bills.totalCents, periodEnd: bills.periodEnd })
    .from(bills)
    .where(inArray(bills.accountId, own.map((row) => row.id)))
    .orderBy(desc(bills.periodEnd));
  const latestBill = (accountId: string) => {
    const bill = billRows.find((row) => row.accountId === accountId);
    return bill ? { amount: dollars(bill.totalCents), periodEnd: bill.periodEnd } : null;
  };

  return {
    company: main.company,
    holder: main.holder,
    approvedOn: longDate.format(approval.approvedAt),
    byOwner: approval.approvedBy === main.holder,
    accounts: numbers.flatMap((number) => {
      const row = own.find((candidate) => candidate.accountNumber === number);
      return row ? [{ accountNumber: number, address: row.address, latestBill: latestBill(row.id) }] : [];
    }),
  };
}

const approval = (facts: CallFacts) =>
  facts.byOwner
    ? `${facts.holder}, the account holder, approved these changes on ${facts.approvedOn}. I'm an AI assistant acting for ${facts.company.replace(/\.$/, "")}.`
    : `This test run was approved automatically on ${facts.approvedOn}, not by a person.`;

// The human's wording. A rep never hears about the dashboard, and nothing here promises a callback, because the product cannot make one.
export const ANSWERS = {
  authorized: (facts: CallFacts) => (facts.byOwner ? `Yes. ${approval(facts)}` : approval(facts)),
  // The rep's fixed question: no "Yes", because it asks who, not whether.
  verify: (facts: CallFacts) => `The service address is ${facts.accounts[0]!.address}. ${approval(facts)}`,
  unknown: (facts: CallFacts) => `${facts.holder}, the account holder, can confirm that, and your question is on the record of this call. For today, may I continue with the approved changes?`,
  beyond: (facts: CallFacts) => `${facts.holder} approved only these changes, so anything else is ${facts.holder}'s decision, and it is on the record of this call. May I continue with the approved changes?`,
};
