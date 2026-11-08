"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logOutAction } from "../../app/(auth)/actions.ts";
import { Wordmark } from "./kit.tsx";

export const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/bills", label: "Bills" },
  { href: "/findings", label: "Findings" },
  { href: "/agents", label: "Agents" },
  { href: "/money", label: "Money" },
];

/** The signed-in top bar. 56 px tall at desktop; on /agents its text steps up to the projector floor of 22 px. */
export function AppNav() {
  const path = usePathname();
  const projector = path.startsWith("/agents");

  return (
    <header className={`flex flex-wrap items-center gap-x-6 border-b border-line bg-sheet px-4 md:h-14 md:flex-nowrap ${projector ? "text-[22px]" : "text-base"}`}>
      <Link href="/overview" className="flex min-h-11 items-center rounded-control text-[1.375em]">
        <Wordmark />
      </Link>
      <nav aria-label="Main" className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t border-line px-4 md:order-none md:mx-0 md:w-auto md:border-0 md:px-0">
        <ul className="flex gap-1">
          {NAV.map((item) => {
            const current = path.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-11 items-center border-b-[3px] px-3 font-semibold whitespace-nowrap md:h-14 ${current ? "border-agent text-ink" : "border-transparent text-faded hover:text-ink"}`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2">
        <span data-testid="demo-data" className="rounded-full border border-line px-3 py-0.5 font-semibold whitespace-nowrap text-faded">
          Demo data
        </span>
        <form action={logOutAction}>
          <button type="submit" data-testid="log-out" className="min-h-11 cursor-pointer rounded-control px-3 font-semibold whitespace-nowrap hover:bg-paper">
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
