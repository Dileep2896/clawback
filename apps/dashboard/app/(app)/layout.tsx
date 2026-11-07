import type { ReactNode } from "react";
import { ReplayBanner } from "../../components/header.tsx";
import { AppNav } from "../../components/ui/app-nav.tsx";
import { LiveProvider } from "../../lib/use-live.tsx";

// The signed-in app. proxy.ts is the login guard: every route here needs a signed session.
// A page marked data-fit-screen (the projector view) gets exactly one screen at desktop width; other pages scroll normally.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <LiveProvider>
      <div className="flex min-h-dvh flex-col min-[1100px]:has-[[data-fit-screen]]:h-dvh">
        <ReplayBanner />
        <AppNav />
        {children}
      </div>
    </LiveProvider>
  );
}
