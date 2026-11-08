"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { logOutAction } from "../../app/(auth)/actions.ts";
import { Wordmark } from "./kit.tsx";

// 24 px line icons drawn for Clawback, stroke only, so they take the text colour.
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

function Icon({ children, className = "size-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const ITEM = "flex min-h-10 cursor-pointer items-center gap-3 rounded-[6px] px-3 font-semibold whitespace-nowrap";

function ThemeToggle({ rail }: { rail: boolean }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  const label = dark ? "Light theme" : "Dark theme";

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Storage can be blocked. The theme still changes for this visit.
    }
  }

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggle}
      aria-label={rail ? label : undefined}
      title={rail ? label : undefined}
      className={`${ITEM} text-faded hover:bg-sheet hover:text-ink ${rail ? "lg:justify-center lg:px-0" : ""}`}
    >
      <Icon>{dark ? <path d="M12 3v2M12 19v2M3 12h2M19 12h2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8" /> : <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5" />}</Icon>
      <span className={rail ? "lg:hidden" : ""}>{label}</span>
    </button>
  );
}

/**
 * The signed-in sidebar: 240 px on paper beside the content sheet. On /agents, the projector screen, it shrinks to a
 * 64 px icon rail so no visible word there is under 22 px; names stay as aria-labels and tooltips.
 * Under 1024 px it is a top bar with a scrolling nav, so a phone never scrolls sideways.
 */
export function AppNav({ company }: { company?: string }) {
  const path = usePathname();
  const rail = path.startsWith("/agents");
  // Hidden labels still count in the projector check's font measure, so the rail sets everything at 22 px.
  const hideOnRail = rail ? "lg:hidden" : "";

  return (
    <header
      className={`z-20 flex flex-wrap items-center gap-x-4 border-b border-line bg-paper px-4 lg:sticky lg:top-0 lg:h-dvh lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:border-r lg:border-b-0 lg:py-4 ${rail ? "text-[22px] lg:w-16 lg:px-2" : "text-[15px] lg:w-60 lg:px-3"}`}
    >
      <Link href="/overview" aria-label={rail ? "Clawback" : undefined} className={`flex min-h-12 items-center rounded-control ${rail ? "lg:justify-center" : "text-[1.25rem] lg:px-3"}`}>
        <Wordmark className={hideOnRail} />
        {rail && (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="hidden size-7 text-money lg:block" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12a7 7 0 1 1-2.05-4.95" />
            <path d="M19 4v4h-4" />
          </svg>
        )}
      </Link>
      {company && !rail && (
        <p data-testid="nav-company" className="hidden truncate px-3 pb-2 text-[13px] font-semibold text-faded lg:block">
          {company}
        </p>
      )}

      <nav aria-label="Main" className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t border-line px-4 py-1 lg:order-none lg:mx-0 lg:mt-4 lg:w-auto lg:overflow-visible lg:border-0 lg:p-0">
        <ul className="flex gap-1 lg:flex-col">
          {NAV.map((item) => {
            const current = path.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  aria-label={rail ? item.label : undefined}
                  title={rail ? item.label : undefined}
                  className={`${ITEM} ${rail ? "lg:justify-center lg:px-0" : ""} ${current ? "bg-sheet text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-faded hover:bg-sheet hover:text-ink"}`}
                >
                  <Icon className={rail ? "size-5 lg:size-6" : "size-5"}>{ICONS[item.href]}</Icon>
                  <span className={hideOnRail}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-x-1 lg:mt-auto lg:ml-0 lg:flex-col lg:items-stretch lg:gap-1">
        {/* On the rail the Agents header carries the Demo data chip at projector size instead: one per page. */}
        {!rail && (
          <span data-testid="demo-data" className="w-fit rounded-full border border-line px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap text-faded lg:mx-3 lg:mb-2">
            Demo data
          </span>
        )}
        <ThemeToggle rail={rail} />
        <form action={logOutAction}>
          <button
            type="submit"
            data-testid="log-out"
            aria-label={rail ? "Log out" : undefined}
            title={rail ? "Log out" : undefined}
            className={`${ITEM} w-full text-faded hover:bg-sheet hover:text-ink ${rail ? "lg:justify-center lg:px-0" : ""}`}
          >
            <Icon>
              <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
            </Icon>
            <span className={hideOnRail}>Log out</span>
          </button>
        </form>
      </div>
    </header>
  );
}
