import { db } from "@bill-fighter/db/client";
import { runs } from "@bill-fighter/db/schema";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Header } from "../../../components/header.tsx";
import { NoAudit } from "../../../components/no-audit.tsx";
import { PageHeader } from "../../../components/ui/kit.tsx";
import { isDemoCustomer } from "../../../lib/accounts.ts";
import { currentSession } from "../../../lib/session.ts";
import { Approval } from "../../../components/panels/approval.tsx";
import { AuditLog } from "../../../components/panels/audit-log.tsx";
import { Board } from "../../../components/panels/board.tsx";
import { Call } from "../../../components/panels/call.tsx";
import { Findings } from "../../../components/panels/findings.tsx";
import { Ledger } from "../../../components/panels/ledger.tsx";
import { Phone } from "../../../components/panels/phone.tsx";

export const metadata: Metadata = { title: "Agents" };

const COLUMN = "grid min-h-0 gap-3 min-[1100px]:grid-rows-[2fr_3fr]";

// The projector view: every word 22 px or larger. Four columns read as the story: the work, the human, the call, the money. One screen wide, stacked when narrow.
export default async function AgentsPage() {
  // A sign-up with no audit gets an honest empty page. The demo customer keeps its empty panels before the stage run starts.
  const session = await currentSession();
  if (session && !isDemoCustomer(session.cid) && !(await db.$count(runs, eq(runs.customerId, session.cid)))) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
        <PageHeader title="Watch your agents work" description="Every step the agents take on your audit, live." />
        <NoAudit />
      </main>
    );
  }
  return (
    <div data-fit-screen className="flex min-h-0 flex-1 flex-col text-[22px] leading-[1.35]">
      <Header />
      <main className="grid min-h-0 flex-1 gap-3 p-3 pt-0 min-[1100px]:grid-cols-[5fr_4fr_5fr_5fr]">
        {/* An even split: the board needs room for all of its states. */}
        <div className="grid min-h-0 gap-3 min-[1100px]:grid-rows-2">
          <Board />
          <Findings />
        </div>
        <div className={COLUMN}>
          <Approval />
          <Phone />
        </div>
        <div className="grid min-h-0">
          <Call />
        </div>
        <div className={COLUMN}>
          <Ledger />
          <AuditLog />
        </div>
      </main>
    </div>
  );
}
