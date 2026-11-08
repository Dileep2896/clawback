"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { logOutAction } from "../../app/(auth)/actions.ts";
import { Wordmark } from "./kit.tsx";

// Line icons drawn for Clawback on a 24 grid, shown at 16 px, stroke only, so they take the text colour.
const ICONS: Record<string, ReactNode> = {
  "/overview": <path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 7h6V4h-6zM4 20h6v-3H4z" />,
  "/bills": <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />,
  "/findings": <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4M11 8v4M11 14.5v.5" />,
  "/agents": <path d="M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4M12 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4M7 8l4 8M17 8l-4 8M8 6h8" />,
  "/money": <path d="M4 19h16M6 15l4-5 3 3 5-7M15 6h3v3" />,
};

export const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/bills", label: "Bills" },
  { href: "/findings", label: "Findings" },
  { href: "/agents", label: "Agents" },
  { href: "/money", label: "Money" },
];

function Icon({ children, className = "size-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const ITEM = "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 whitespace-nowrap";

/** The signed-in sidebar: 240 px on paper beside the content sheet. Under 1024 px it is a top bar with a scrolling nav, so a phone never scrolls sideways. */
export function AppNav({ company }: { company?: string }) {
  const path = usePathname();

  return (
    <header className="z-20 flex flex-wrap items-center gap-x-4 border-b border-line bg-paper px-4 lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:border-r lg:border-b-0 lg:px-3 lg:py-4">
      <Link href="/overview" className="flex min-h-12 items-center rounded-control text-title lg:px-2.5">
        <Wordmark />
      </Link>
      {company && (
        <p data-testid="nav-company" className="hidden truncate px-2.5 pb-2 text-label text-faded lg:block">
          {company}
        </p>
      )}

      <nav aria-label="Main" className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t border-line px-4 py-1 lg:order-none lg:mx-0 lg:mt-4 lg:w-auto lg:overflow-visible lg:border-0 lg:p-0">
        <ul className="flex gap-0.5 lg:flex-col">
          {NAV.map((item) => {
            const current = path.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`${ITEM} ${current ? "bg-sheet font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-faded hover:bg-sheet hover:text-ink"}`}
                >
                  <Icon>{ICONS[item.href]}</Icon>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-x-1 lg:mt-auto lg:ml-0 lg:flex-col lg:items-stretch lg:gap-1">
        <span data-testid="demo-data" className="w-fit rounded-full border border-line px-2.5 py-0.5 text-caption whitespace-nowrap text-faded lg:mx-2.5 lg:mb-2">
          Demo data
        </span>
        <form action={logOutAction}>
          <button type="submit" data-testid="log-out" className={`${ITEM} w-full text-faded hover:bg-sheet hover:text-ink`}>
            <Icon>
              <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
            </Icon>
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
