import type { Metadata } from "next";
import { ButtonLink, EmptyState, PageHeader } from "../../../components/ui/kit.tsx";

export const metadata: Metadata = { title: "Money" };

// Placeholder with the real layout; savings-views fills it.
export default function MoneyPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader title="Money" description="Refunds, savings, Clawback's fee and your invoice." />
      <EmptyState title="Nothing recorded yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
        Every refund, saving and Clawback's fee is recorded here as a ledger row, with your invoice.
      </EmptyState>
    </main>
  );
}
