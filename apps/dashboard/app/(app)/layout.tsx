import type { ReactNode } from "react";
import { db } from "@bill-fighter/db/client";
import { ReplayBanner } from "../../components/header.tsx";
import { AppNav } from "../../components/ui/app-nav.tsx";
import { findUser } from "../../lib/accounts.ts";
import { currentSession } from "../../lib/session.ts";
import { LiveProvider } from "../../lib/use-live.tsx";

// The signed-in app. proxy.ts is the login guard: every route here needs a signed session.
// Sidebar on paper, content on the sheet. A page marked data-fit-screen (the projector view) gets exactly one screen at desktop width; other pages scroll normally.
export default async function AppLayout({ children }: { children: ReactNode }) {
  // A script's minted session has no user row, so the company line is optional.
  const session = await currentSession();
  const user = session && (await findUser(db, session.uid));

  return (
    <LiveProvider>
      <div className="flex min-h-dvh flex-col bg-sheet lg:flex-row">
        <AppNav company={user?.company} />
        <div className="flex min-w-0 flex-1 flex-col min-[1100px]:has-[[data-fit-screen]]:h-dvh">
          <ReplayBanner />
          {children}
        </div>
      </div>
    </LiveProvider>
  );
}
