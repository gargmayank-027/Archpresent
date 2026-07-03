/**
 * lib/auth.ts — NextAuth configuration
 *
 * Providers: Google, Apple, Email/Password (Credentials)
 * Session strategy: JWT (no database needed)
 *
 * Required env vars:
 *   NEXTAUTH_SECRET          — `openssl rand -base64 32`
 *   NEXTAUTH_URL             — https://your-domain.com (not needed on Vercel)
 *   GOOGLE_CLIENT_ID         — from Google Cloud Console (optional)
 *   GOOGLE_CLIENT_SECRET     — from Google Cloud Console (optional)
 *   APPLE_ID                 — from Apple Developer Portal (optional)
 *   APPLE_SECRET             — from Apple Developer Portal (optional)
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { findUserByEmail, verifyPassword } from "@/lib/userStore";

export const authOptions: NextAuthOptions = {
  providers: [
    // ── Email / Password ──────────────────────────────────────────────
    CredentialsProvider({
      id: "credentials",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await findUserByEmail(credentials.email);
        if (!user) return null;

        const valid = await verifyPassword(user, credentials.password);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email };
      },
    }),

    // ── Google (optional — only enabled if env vars are set) ──────────
    ...(process.env.GOOGLE_CLIENT_ID ? (() => {
      const GoogleProvider = require("next-auth/providers/google").default;
      return [GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      })];
    })() : []),

    // ── Apple (optional) ─────────────────────────────────────────────
    ...(process.env.APPLE_ID ? (() => {
      const AppleProvider = require("next-auth/providers/apple").default;
      return [AppleProvider({
        clientId: process.env.APPLE_ID!,
        clientSecret: process.env.APPLE_SECRET!,
      })];
    })() : []),
  ],

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  pages: {
    signIn: "/login",
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
      if (url === baseUrl || url === `${baseUrl}/`) return `${baseUrl}/dashboard`;
      if (url.startsWith(baseUrl)) return url;
      return `${baseUrl}/dashboard`;
    },
  },
};
