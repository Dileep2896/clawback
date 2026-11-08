import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "../../components/ui/kit.tsx";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col text-body">
      <header className="mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center text-title">
          <Wordmark />
        </Link>
      </header>
      <main className="mx-auto grid w-full max-w-[30rem] flex-1 content-start px-4 pt-6 pb-16 sm:pt-12">{children}</main>
      <footer className="mx-auto max-w-[1200px] px-4 pb-8 text-center text-label text-faded sm:px-6">Demo data. Accounts here are for the demo and are cleared after each one.</footer>
    </div>
  );
}
