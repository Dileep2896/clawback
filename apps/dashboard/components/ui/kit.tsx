import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// The shared building blocks from docs/plan/design.md. Server-safe: no hooks, so any page can use them.

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
          {title && <h2 className="text-[1.375rem] leading-snug font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** One figure the room should read from the back: money in the green serif, anything else in plain ink. */
export function StatTile({ label, value, note, tone = "plain", testId }: { label: string; value: string; note?: string; tone?: "money" | "plain"; testId?: string }) {
  return (
    <div className="rounded-card border border-line bg-sheet p-6">
      <p className="text-faded">{label}</p>
      <p data-testid={testId} className={`mt-1 font-figure text-5xl leading-none ${tone === "money" ? "text-money" : ""}`}>
        {value}
      </p>
      {note && <p className="mt-2 text-base text-faded">{note}</p>}
    </div>
  );
}

/** Rows go in as plain <tr>/<td>. Right-align money cells with className="text-right tabular-nums". */
export function Table({ head, children, caption }: { head: { label: string; numeric?: boolean }[]; children: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-sheet">
      <table className="w-full border-collapse text-left [&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-3">
        {caption && <caption className="px-4 pt-3 text-left text-base text-faded">{caption}</caption>}
        <thead>
          <tr>
            {head.map((column) => (
              <th key={column.label} scope="col" className={`px-4 py-3 text-base font-semibold text-faded ${column.numeric ? "text-right" : ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-card border border-dashed border-faded/50 bg-sheet px-8 py-12">
      <h2 className="text-[1.375rem] leading-snug font-semibold">{title}</h2>
      <div className="max-w-[60ch] text-faded">{children}</div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[2.5rem] leading-tight font-bold">{title}</h1>
        {description && <p className="mt-1 max-w-[65ch] text-faded">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/** The product's mark: a returning arrow, the money coming back, in the money green. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1.2em] text-money" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12a7 7 0 1 1-2.05-4.95" />
        <path d="M19 4v4h-4" />
      </svg>
      Clawback
    </span>
  );
}
