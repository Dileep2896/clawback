import { db } from "@bill-fighter/db/client";
import { runs } from "@bill-fighter/db/schema";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { AgentsView } from "../../../components/agents/agents-view.tsx";
import { NoAudit } from "../../../components/no-audit.tsx";
import { PageHeader } from "../../../components/ui/kit.tsx";
import { isDemoCustomer } from "../../../lib/accounts.ts";
import { currentSession } from "../../../lib/session.ts";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  // A sign-up with no audit gets an honest empty page. The demo customer waits on its header before the stage run starts.
  const session = await currentSession();
  if (session && !isDemoCustomer(session.cid) && !(await db.$count(runs, eq(runs.customerId, session.cid)))) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
        <PageHeader title="Watch your agents work" description="Every step the agents take on your audit, live." />
        <NoAudit />
      </main>
    );
  }
  return <AgentsView />;
}
