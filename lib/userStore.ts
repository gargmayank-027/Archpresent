/**
 * lib/userStore.ts
 *
 * Lightweight user storage for email/password authentication.
 * Uses the same JSON-file pattern as projectStore for local dev,
 * and Vercel Blob for production.
 *
 * Users are stored with bcrypt-hashed passwords. OAuth users (Google/Apple)
 * don't need entries here — they're handled entirely by NextAuth.
 */

import bcrypt from "bcryptjs";

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

const IS_VERCEL = !!process.env.VERCEL;
const SALT_ROUNDS = 10;

// ── In-memory cache (local dev) ──────────────────────────────────────────

let usersCache: StoredUser[] | null = null;

function getUsersPath(): string {
  const { join } = require("path") as typeof import("path");
  return join(process.cwd(), "public", "uploads", "users.json");
}

function loadUsers(): StoredUser[] {
  if (usersCache) return usersCache;
  try {
    const { readFileSync, existsSync } = require("fs") as typeof import("fs");
    const p = getUsersPath();
    if (!existsSync(p)) return [];
    usersCache = JSON.parse(readFileSync(p, "utf-8"));
    return usersCache!;
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  const { writeFileSync, mkdirSync, existsSync } = require("fs") as typeof import("fs");
  const { dirname } = require("path") as typeof import("path");
  const p = getUsersPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(users, null, 2));
  usersCache = users;
}

// ── Vercel Blob storage ──────────────────────────────────────────────────

async function blobLoadUsers(): Promise<StoredUser[]> {
  try {
    const { list, head } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: "users.json" });
    if (blobs.length === 0) return [];
    const res = await fetch(blobs[0].url);
    return await res.json();
  } catch {
    return [];
  }
}

async function blobSaveUsers(users: StoredUser[]): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put("users.json", JSON.stringify(users), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

// ── Public API ───────────────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const users = IS_VERCEL ? await blobLoadUsers() : loadUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function createUser(name: string, email: string, password: string): Promise<StoredUser> {
  const existing = await findUserByEmail(email);
  if (existing) throw new Error("An account with this email already exists.");

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user: StoredUser = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  const users = IS_VERCEL ? await blobLoadUsers() : loadUsers();
  users.push(user);
  IS_VERCEL ? await blobSaveUsers(users) : saveUsers(users);

  return user;
}

export async function verifyPassword(user: StoredUser, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}
