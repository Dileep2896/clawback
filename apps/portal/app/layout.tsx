import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo provider portal",
  description: "A fictional provider portal for a demo. Not a real utility.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <p data-testid="demo-banner" className="relative z-10 bg-caution px-4 py-2 text-center font-semibold text-ink">
          Demo portal, not a real utility
        </p>
        {children}
      </body>
    </html>
  );
}
