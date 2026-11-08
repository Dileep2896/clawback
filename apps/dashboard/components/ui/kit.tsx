import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { ReplayInfo } from "../../lib/replay.ts";
import { SandboxPill } from "../sandbox-pill.tsx";

// The shared building blocks from docs/plan/design.md. Server-safe: no hooks, so any page can use them (PageHeader's sandbox pill is a client component with no hooks of its own beyond useId).

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-action text-action-text hover:brightness-110",
  secondary: "border border-faded bg-sheet text-ink hover:bg-paper",
  ghost: "text-ink hover:bg-paper",
};

const buttonClass = (variant: Variant, className = "") =>
  `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control px-4 font-semibold whitespace-nowrap disabled:cursor-wait disabled:opacity-70 ${VARIANTS[variant]} ${className}`;

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function Card({ title, actions, className = "", children }: { title?: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-card border border-line bg-sheet p-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-title font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** One figure: money in the green serif, anything else in plain ink. Body size, because each page has only one larger (hero) figure. */
export function StatTile({ label, value, note, tone = "plain", testId }: { label: string; value: string; note?: string; tone?: "money" | "plain"; testId?: string }) {
  return (
    <div className="rounded-card border border-line bg-sheet p-6">
      <p className="text-label text-faded">{label}</p>
      <p data-testid={testId} className={`mt-2 font-figure text-body ${tone === "money" ? "text-money" : ""}`}>
        {value}
      </p>
      {note && <p className="mt-1 text-label text-faded">{note}</p>}
    </div>
  );
}

/** Rows go in as plain <tr>/<td>. Right-align money cells with className="text-right tabular-nums". 14 px rows, 12 px sticky header, hairlines, no zebra. */
/** grouped: children are whole <tbody> elements, one per group, instead of rows. */
export function Table({ head, children, caption, grouped }: { head: { label: string; numeric?: boolean }[]; children: ReactNode; caption?: string; grouped?: boolean }) {
  return (
    // Horizontal scroll only under 1024 px: any overflow box at desktop would trap the sticky header inside it.
    <div className="rounded-card border border-line bg-sheet max-lg:overflow-x-auto">
      <table className="w-full border-collapse text-left text-body [&_td]:h-11 [&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-2 [&_tbody_tr]:hover:bg-paper/60">
        {caption && <caption className="px-4 pt-3 pb-1 text-left text-caption text-faded">{caption}</caption>}
        <thead className="sticky top-0 z-[1] bg-sheet [&_th:first-child]:rounded-tl-card [&_th:last-child]:rounded-tr-card">
          <tr>
            {head.map((column) => (
              <th key={column.label} scope="col" className={`h-9 px-4 text-caption font-normal text-faded ${column.numeric ? "text-right" : ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        {grouped ? children : <tbody>{children}</tbody>}
      </table>
    </div>
  );
}

/** A small status: a dot and a word, never a filled badge. alert = a wrong amount or error, money = money confirmed, agent/live = agents at work. */
export function StatusDot({ tone = "plain", children }: { tone?: "alert" | "money" | "agent" | "plain" | "live"; children: ReactNode }) {
  const dot = { alert: "bg-alert", money: "bg-money", agent: "bg-agent", plain: "bg-faded/50", live: "bg-agent animate-pulse motion-reduce:animate-none" }[tone];
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${tone === "alert" ? "text-alert" : tone === "plain" ? "text-faded" : ""}`}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/** A small outlined label, such as a finding's rule. */
export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-[6px] border border-line px-2 py-0.5 text-label whitespace-nowrap text-faded ${className}`}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-card border border-dashed border-faded/50 bg-sheet px-8 py-12">
      <h2 className="text-title font-semibold">{title}</h2>
      <div className="max-w-[60ch] text-faded">{children}</div>
      {action}
    </div>
  );
}

/** The in-content top bar: the company above the page title, one line of description, actions on the right. A replayed run puts its sandbox pill beside the title. */
export function PageHeader({ title, description, actions, crumb, replay }: { title: string; description?: string; actions?: ReactNode; crumb?: string; replay?: ReplayInfo | null }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        {crumb && <p className="text-label text-faded">{crumb}</p>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-page font-semibold">{title}</h1>
          {replay && <SandboxPill replay={replay} />}
        </div>
        {description && <p className="mt-1 max-w-[70ch] text-faded">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/** The product's mark: a returning arrow, the money coming back, in the money green. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1.2em] text-money" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12a7 7 0 1 1-2.05-4.95" />
        <path d="M19 4v4h-4" />
      </svg>
      Clawback
    </span>
  );
}
