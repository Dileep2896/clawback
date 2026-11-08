import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink, Wordmark } from "../ui/kit.tsx";

// The public site's shared frame: the landing and its four detail pages use the same nav, footer and section intro.

export const PAGES = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/compare", label: "Why Clawback" },
  { href: "/market", label: "The market" },
];

export const WIDTH = "mx-auto w-full max-w-[1320px] px-4 sm:px-6";
export const LABEL = "font-mono text-[12px] tracking-[0.12em] uppercase";

/** A section intro as one large two-tone sentence: the claim in ink, the rest in grey. */
export function Statement({ id, lead, children }: { id: string; lead: string; children: ReactNode }) {
  return (
    <h2 id={id} className="max-w-[30ch] text-[clamp(1.75rem,3.2vw,2.75rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
      {lead} <span className="text-faded">{children}</span>
    </h2>
  );
}

/** A detail page's opening: a small mono caption, then a 72 px two-tone headline and one line of subcopy. */
export function PageIntro({ caption, lead, rest, children }: { caption: string; lead: string; rest: string; children?: ReactNode }) {
  return (
    <section aria-labelledby="page-title" className={`${WIDTH} grid gap-6 pt-16 pb-12 lg:pt-24 lg:pb-16`}>
      <p className={`${LABEL} text-faded`}>{caption}</p>
      <h1 id="page-title" className="max-w-[22ch] text-[clamp(2.5rem,5.4vw,4.5rem)] leading-[1.04] font-semibold tracking-[-0.03em]">
        {lead} <span className="text-faded">{rest}</span>
      </h1>
      {children && <div className="max-w-[60ch] text-[1.125rem] text-faded">{children}</div>}
    </section>
  );
}

/** A link to a detail page, set as an underlined text link (the landing's teasers and each page's next step). */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="w-fit font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink">
      {children}
    </Link>
  );
}

function Header({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-10 bg-paper/80 backdrop-blur-md">
      <div className={`${WIDTH} flex h-16 items-center gap-x-2 min-[360px]:gap-x-4 sm:gap-x-8`}>
        <Link href="/" aria-label="Clawback home" className="shrink-0 rounded-control text-[1.125rem] min-[360px]:text-[1.25rem] sm:text-[1.375rem]">
          <Wordmark />
        </Link>
        <nav aria-label="Site" className="hidden md:block">
          <ul className="flex gap-6 text-[15px] text-faded">
            {PAGES.map((link) => (
              <li key={link.href}>
                <Link href={link.href} aria-current={current === link.href ? "page" : undefined} className="hover:text-ink aria-[current=page]:text-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Account" className="ml-auto flex items-center gap-1">
          <ButtonLink href="/login" variant="ghost" className="text-[15px] font-normal text-faded hover:text-ink max-[360px]:px-1.5 min-[360px]:px-2 sm:px-4" data-testid="log-in">
            Log in
          </ButtonLink>
          <ButtonLink href="/signup" className="text-[15px] max-[360px]:px-2.5" data-testid="get-started">
            {/* Under 360px the header keeps one row: a shorter CTA, a smaller wordmark, tighter gaps. One span, so the
                button's flex gap doesn't split the words. */}
            <span>
              Start <span className="max-[360px]:hidden">my </span>audit
            </span>
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}

/** The closing band every public page ends on. */
function CtaBand() {
  return (
    <section aria-labelledby="cta" className="canvas border-y border-line bg-sheet">
      <div className={`${WIDTH} flex flex-wrap items-center justify-between gap-8 py-20 lg:py-28`}>
        <h2 id="cta" className="max-w-[22ch] text-[clamp(2rem,3.4vw,3rem)] leading-[1.1] font-semibold tracking-[-0.02em]">
          You only pay from what comes back.
        </h2>
        <ButtonLink href="/signup" className="min-h-12 px-5">
          Start my audit
        </ButtonLink>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className={`${WIDTH} grid gap-10 py-14 text-[15px] sm:grid-cols-2 lg:grid-cols-12`}>
      <div className="grid content-start gap-4 lg:col-span-6">
        <Wordmark className="text-[1.25rem]" />
        <p className="flex max-w-[60ch] items-start gap-3 rounded-[12px] border border-line px-4 py-3 text-faded">
          <span className="shrink-0 rounded-full bg-paper px-2 font-semibold text-ink">Demo data</span>
          Golden Gate Noodle Co. is a fictional demo customer. Every bill, provider and figure here is demo data.
        </p>
      </div>
      <nav aria-label="Product" className="lg:col-span-3">
        <p className="text-[15px] font-semibold">Product</p>
        <ul className="mt-4 grid gap-2">
          {PAGES.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="hover:underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Your account" className="lg:col-span-3">
        <p className="text-[15px] font-semibold">Account</p>
        <ul className="mt-4 grid gap-2">
          <li>
            <Link href="/signup" className="hover:underline">
              Start my audit
            </Link>
          </li>
          <li>
            <Link href="/login" className="hover:underline">
              Log in
            </Link>
          </li>
        </ul>
      </nav>
    </footer>
  );
}

/** Nav, page, closing band, footer. `current` marks the page's own nav link. */
export function SiteFrame({ current, children }: { current?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <Header current={current} />
      <main id="top">
        {children}
        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}
