/**
 * app/api/auth/register/route.ts
 *
 * POST /api/auth/register
 *   { name, email, password }
 *   → { success: true } or { error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/lib/userStore";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    // Validation
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    if (!email?.trim() || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }

    await createUser(name.trim(), email.trim(), password);

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Registration failed.";
    // "already exists" is a 409, everything else is 500
    const status = msg.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
