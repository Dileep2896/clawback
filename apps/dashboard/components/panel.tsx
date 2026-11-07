import { type ReactNode, useId } from "react";

/** The frame for every panel: a title band like a bill's section header, and a body that scrolls inside itself. */
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex min-h-0 flex-col overflow-hidden rounded-[3px] border-2 border-drum bg-sheet max-[1099px]:min-h-72">
      <h2 id={titleId} className="bg-drum px-4 py-1.5 font-display text-[1.75rem] leading-tight font-semibold text-drum-text">
        {title}
      </h2>
      {/* Focusable so a scrolling panel can be scrolled by keyboard. Relative so sr-only text cannot stretch the page past this panel. */}
      <div tabIndex={0} aria-labelledby={titleId} role="group" className="relative min-h-0 flex-1 overflow-y-auto p-4">
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
