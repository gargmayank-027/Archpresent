/**
 * lib/auth.ts — NextAuth configuration
 *
 * Providers: Google, Apple
 * Session strategy: JWT (no database needed)
 *
 * Required env vars:
 *   NEXTAUTH_SECRET          — `openssl rand -base64 32`
 *   NEXTAUTH_URL             — https://your-domain.com
 *   GOOGLE_CLIENT_ID         — from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET     — from Google Cloud Console
 *   APPLE_ID                 — from Apple Developer Portal
 *   APPLE_SECRET             — from Apple Developer Portal
 */

import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";

export const authOptions: NextAuthOptions = {
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID ? [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
    ] : []),
    ...(process.env.APPLE_ID ? [
      AppleProvider({
        clientId: process.env.APPLE_ID!,
        clientSecret: process.env.APPLE_SECRET!,
      }),
    ] : []),
  ],

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  pages: {
    signIn: "/login",
    // After sign-in, the middleware checks if firm is set up
    // and redirects to /onboarding if not.
  },

  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.provider = account?.provider;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).provider = token.provider;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // After sign-in, go to /dashboard (middleware will redirect to /onboarding if needed)
      if (url === baseUrl || url === `${baseUrl}/`) return `${baseUrl}/dashboard`;
      if (url.startsWith(baseUrl)) return url;
      return `${baseUrl}/dashboard`;
    },
  },
};
