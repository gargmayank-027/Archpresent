/**
 * middleware.ts — Route protection + onboarding gate
 *
 * Public routes: /, /login, /share/*, /api/auth/*, /api/share/*
 * Protected routes: everything else
 *
 * After auth, if no firm profile exists → redirect to /onboarding
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/share",
  "/api/auth",
  "/api/share",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

// Static assets and Next.js internals — skip middleware entirely
function isAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/uploads") ||
    pathname.includes(".")
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip static assets
  if (isAsset(pathname)) return NextResponse.next();

  // Allow public routes
  if (isPublic(pathname)) return NextResponse.next();

  // Check auth
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — check if onboarding is needed
  // (skip if already on /onboarding or /api routes to avoid redirect loops)
  if (pathname !== "/onboarding" && !pathname.startsWith("/api")) {
    try {
      const firmRes = await fetch(new URL("/api/firm", req.url), {
        headers: { cookie: req.headers.get("cookie") ?? "" },
      });
      const firmData = await firmRes.json();
      if (!firmData.firm) {
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }
    } catch {
      // If firm check fails, let them through — don't block on a network error
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
