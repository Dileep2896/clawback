import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bill Fighter dashboard",
  description: "A live view of one Bill Fighter run, with fictional demo data.",
};

// Runs before first paint, so a saved dark theme does not flash light. Storage can throw in a private window.
const RESTORE_THEME = `try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark"}catch{}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The script above changes data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RESTORE_THEME }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
