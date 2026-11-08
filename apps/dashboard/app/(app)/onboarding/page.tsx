import { db } from "@bill-fighter/db/client";
import { locations } from "@bill-fighter/db/schema";
import { count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Card, PageHeader } from "../../../components/ui/kit.tsx";
import { isDemoCustomer } from "../../../lib/accounts.ts";
import { requireUser } from "../../../lib/session.ts";
import { ConnectBills } from "./connect.tsx";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const [{ sites }] = (await db.select({ sites: count() }).from(locations).where(eq(locations.customerId, user.customerId))) as [{ sites: number }];
  const firstName = user.name.split(" ")[0];

  const business = (
    <Card title="1. Your business">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-1">
        <div>
          <dt className="text-body text-faded">Company</dt>
          <dd data-testid="onboarding-company">
            {user.company}
          </dd>
        </div>
        <div>
          <dt className="text-body text-faded">Account owner</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt className="text-body text-faded">Locations on file</dt>
          <dd data-testid="onboarding-sites">
            {sites > 0 ? sites : "Added from your bills"}
          </dd>
        </div>
      </dl>
    </Card>
  );

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader title={`Welcome, ${firstName}`} description="Two steps and the agents start reading your bills." />
      <ConnectBills demo={isDemoCustomer(user.customerId)} queued={user.auditRequestedAt !== null} business={business} />
    </main>
  );
}
