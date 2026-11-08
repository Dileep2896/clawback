import type { ReactNode } from "react";

export const NOT_RECORDED = "Not recorded yet";

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export const runDate = (iso: string) => dateTime.format(new Date(iso));
/** Bill periods are plain dates, so they are read as UTC to stay on the printed day. */
export const billDay = (date: string) => day.format(new Date(`${date}T00:00:00Z`));

export const PROVIDERS: Record<string, string> = { baycurrent: "BayCurrent", baytel: "BayTel", bayconnect: "BayConnect", bayhearth: "BayHearth" };
export const SERVICES: Record<string, string> = { electric: "Electric", gas: "Gas", telecom: "Phone", internet: "Internet" };

/** The product-page column from docs/plan/design.md: 16 px base, denser than the landing. */
export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-[1440px] px-4 py-8 text-body sm:px-8">{children}</main>;
}
