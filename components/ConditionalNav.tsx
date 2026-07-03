"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { NavBar } from "./NavBar";

const HIDE_NAV_PATHS = ["/", "/login", "/signup", "/onboarding"];

export function ConditionalNav() {
  const pathname = usePathname();
  const { status } = useSession();

  // Hide nav on public pages and onboarding
  if (HIDE_NAV_PATHS.includes(pathname)) return null;

  // Also hide for share pages (client-facing, no nav needed)
  if (pathname.startsWith("/share")) return null;

  // Only show nav when authenticated
  if (status !== "authenticated") return null;

  return <NavBar />;
}
