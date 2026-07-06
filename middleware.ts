/**
 * middleware.ts — Auth-only route protection
 *
 * SIMPLE: just checks if the user has a valid JWT token.
 * NO internal fetch calls (those cause circular requests and hangs).
 * Onboarding check is done CLIENT-SIDE in the dashboard/layout, not here.
 *
 * Public: /, /login, /signup, /share/*, /api/auth/*, /api/share/*
 * Protected: everything else
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/", "/login", "/signup", "/share", "/api/auth", "/api/share"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/uploads") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Public routes — no auth needed
  if (isPublic(pathname)) return NextResponse.next();

  // Check JWT token
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
