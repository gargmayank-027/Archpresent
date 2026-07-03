/**
 * app/layout.tsx — Root layout with auth + conditional nav
 */

import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { ConditionalNav } from "@/components/ConditionalNav";
import { ConditionalMain } from "@/components/ConditionalMain";

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
        <AuthProvider>
          <ConditionalNav />
          <ConditionalMain>{children}</ConditionalMain>
        </AuthProvider>
      </body>
    </html>
  );
}
