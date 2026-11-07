import type { Metadata } from "next";
import { ButtonLink, EmptyState, PageHeader } from "../../../components/ui/kit.tsx";

export const metadata: Metadata = { title: "Overview" };

// Placeholder with the real layout; savings-views fills it.
export default function OverviewPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader title="Overview" description="Money recovered, yearly savings and anything that needs your approval." />
      <EmptyState title="Your savings show here once the agents finish" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
        The agents are reading your bills. Refunds, savings and Clawback&apos;s fee appear here as soon as they are recorded.
      </EmptyState>
    </main>
  );
}
