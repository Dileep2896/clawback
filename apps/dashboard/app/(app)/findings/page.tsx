import type { Metadata } from "next";
import { ButtonLink, EmptyState, PageHeader } from "../../../components/ui/kit.tsx";

export const metadata: Metadata = { title: "Findings" };

// Placeholder with the real layout; savings-views fills it.
export default function FindingsPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader title="Findings" description="What we found wrong on your bills, with the evidence for each." />
      <EmptyState title="No findings yet" action={<ButtonLink href="/agents">Watch your agents work</ButtonLink>}>
        Each overcharge the auditor finds shows here with the bill line, the usage and the rate it should have been.
      </EmptyState>
    </main>
  );
}
