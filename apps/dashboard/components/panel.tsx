import { type ReactNode, useId } from "react";

/** The frame for every panel: a title band like a bill's section header, and a body that scrolls inside itself. */
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-sheet max-[1099px]:min-h-72">
      <h2 id={titleId} className="border-b border-line px-4 pt-2 pb-1.5 text-[1.625rem] leading-tight font-bold">
        {title}
      </h2>
      {/* Focusable so a scrolling panel can be scrolled by keyboard. Relative so sr-only text cannot stretch the page past this panel. */}
      <div tabIndex={0} aria-labelledby={titleId} role="group" className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {children}
      </div>
    </section>
  );
}

/** A live row count, until the panel's own lane replaces it. */
export function PanelStub({ count, noun }: { count: number; noun: string }) {
  return (
    <p className="text-faded">
      {count === 0 ? `No ${noun}s yet` : `${count} ${noun}${count === 1 ? "" : "s"} on this run`}
    </p>
  );
}
