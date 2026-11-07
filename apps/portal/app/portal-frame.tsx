import type { ReactNode } from "react";
import { BRANDS } from "../lib/brands.ts";
import { modalSeen, type Session } from "../lib/session.ts";
import { BrandBand } from "./brand-band.tsx";
import { SessionModal } from "./session-modal.tsx";

/** The frame for every signed-in page. The session modal lives here, so it blocks whichever page comes first. */
export async function PortalFrame({ session, children }: { session: Session; children: ReactNode }) {
  const showModal = !(await modalSeen(session));
  return (
    <>
      <div inert={showModal}>
        <BrandBand brand={BRANDS[session.provider]} />
        <nav aria-label="Portal" className="mx-auto flex max-w-5xl gap-6 px-4 pt-6 sm:px-8">
          <a href="/accounts" data-testid="nav-accounts" className="underline">
            Accounts
          </a>
          {session.provider === "baytel" && (
            <a href="/lines" data-testid="nav-lines" className="underline">
              Phone lines
            </a>
          )}
        </nav>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">{children}</main>
      </div>
      {showModal && <SessionModal />}
    </>
  );
}
