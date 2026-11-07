import type { Metadata } from "next";
import { ButtonLink, EmptyState, PageHeader } from "../../../components/ui/kit.tsx";

export const metadata: Metadata = { title: "Bills" };

// Placeholder with the real layout; savings-views fills it.
export default function BillsPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader title="Bills" description="Every bill we have, for each account and location." />
      <EmptyState title="No bills yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
        Bills appear here once you upload them or the agents download them from your provider&apos;s portal.
      </EmptyState>
    </main>
  );
}
