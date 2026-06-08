/**
 * app/layout.tsx — Root layout with firm-aware nav
 */

import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "ArchPresent — Concept Presentations for Architects",
  description: "Turn floor plans into client-ready concept presentations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Mono:wght@300;400;500&family=Instrument+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-stone-50 text-stone-900 antialiased">
        <NavBar />
        <main className="pt-14 min-h-screen">{children}</main>
        <footer className="border-t border-stone-200 mt-24">
          <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between">
            <p className="text-xs font-mono text-stone-400 tracking-widest uppercase">ArchPresent v1</p>
            <p className="text-xs font-mono text-stone-400">Residential concept presentations</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
