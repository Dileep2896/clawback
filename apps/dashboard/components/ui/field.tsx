import type { ComponentProps } from "react";

/** A labelled input in the design's control style. The label sits above, so it stays readable once the field is filled. */
export function Field({ label, hint, className = "", ...input }: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className={`grid gap-1.5 ${className}`}>
      <span className="font-semibold">{label}</span>
      <input
        className="min-h-12 rounded-control border border-faded/60 bg-sheet px-3 text-ink outline-none focus-visible:border-action focus-visible:ring-2 focus-visible:ring-action/30"
        {...input}
      />
      {hint && <span className="text-base text-faded">{hint}</span>}
    </label>
  );
}

export function FormError({ children }: { children?: string }) {
  return children ? (
    <p role="alert" data-testid="form-error" className="rounded-control border border-alert/40 bg-sheet px-4 py-3 font-semibold text-alert">
      {children}
    </p>
  ) : null;
}
