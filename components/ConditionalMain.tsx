"use client";

import { usePathname } from "next/navigation";

const NO_PADDING_PATHS = ["/", "/login", "/signup", "/onboarding"];

export function ConditionalMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const needsPadding = !NO_PADDING_PATHS.includes(pathname) && !pathname.startsWith("/share");

  return (
    <main className={`min-h-screen ${needsPadding ? "pt-14" : ""}`}>
      {children}
    </main>
  );
}
