import { db } from "@bill-fighter/db/client";
import { runs } from "@bill-fighter/db/schema";
import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { Bills } from "../../../components/savings/bills.tsx";
import { currentSession } from "../../../lib/session.ts";
import { customerBills } from "../../../lib/snapshot.ts";

export const metadata: Metadata = { title: "Bills" };

/** The live feed follows the latest run. A customer who is not that run's, such as a new sign-up with uploads, sees their own bills instead. */
export default async function BillsPage() {
  const session = await currentSession();
  const [run] = await db.select({ customerId: runs.customerId }).from(runs).orderBy(desc(runs.startedAt), desc(runs.id)).limit(1);
  const own = session && session.cid !== run?.customerId ? await customerBills(db, session.cid) : undefined;
  return <Bills own={own} />;
}
