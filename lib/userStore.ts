/**
 * lib/userStore.ts
 *
 * User storage for email/password auth.
 * Uses Supabase Storage (same as projects/firm), local filesystem for dev.
 */

import bcrypt from "bcryptjs";

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

const USE_SUPABASE = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const SALT_ROUNDS = 10;

// ── Load / save users ───────────────────────────────────────────────────

async function loadUsers(): Promise<StoredUser[]> {
  if (USE_SUPABASE) {
    try {
      const { supaDownload } = await import("@/lib/supabase");
      const buf = await supaDownload("users.json");
      return JSON.parse(buf.toString()) as StoredUser[];
    } catch {
      return [];
    }
  }

  // Local dev
  try {
    const { readFileSync, existsSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const p = join(process.cwd(), "public", "uploads", "users.json");
    if (!existsSync(p)) return [];
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

async function saveUsers(users: StoredUser[]): Promise<void> {
  if (USE_SUPABASE) {
    const { supaUpload } = await import("@/lib/supabase");
    await supaUpload(Buffer.from(JSON.stringify(users, null, 2)), "users.json", "application/json");
    return;
  }

  // Local dev
  const { writeFileSync, mkdirSync, existsSync } = require("fs") as typeof import("fs");
  const { join, dirname } = require("path") as typeof import("path");
  const p = join(process.cwd(), "public", "uploads", "users.json");
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(users, null, 2));
}

// ── Public API ───────────────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const users = await loadUsers();
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

  const users = await loadUsers();
  users.push(user);
  await saveUsers(users);

  return user;
}

export async function verifyPassword(user: StoredUser, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}
