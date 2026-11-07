import { ButtonLink, EmptyState } from "./ui/kit.tsx";

/** What a customer with no audit sees on Overview, Findings, Money and Agents, instead of anyone else's run. Server-safe: no hooks. */
export function NoAudit() {
  return (
    <div data-testid="no-audit">
      <EmptyState title="No audit yet" action={<ButtonLink href="/onboarding">Connect your bills</ButtonLink>}>
        Once your bills are in and your audit starts, the agents&apos; work, your refunds, your savings and Clawback&apos;s fee show up here.
      </EmptyState>
    </div>
  );
}
