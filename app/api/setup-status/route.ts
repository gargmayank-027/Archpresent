/**
 * app/api/setup-status/route.ts
 *
 * GET /api/setup-status
 * Returns which API keys are configured (never exposes the keys themselves).
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    gemini:       process.env.GOOGLE_AI_KEY        ? "ok" : "missing",
    unsplash:     process.env.UNSPLASH_ACCESS_KEY  ? "ok" : "missing", // first-draft real photos
    // "ok" if a key is set (reliable), "unkeyed" if relying on the shared
    // anonymous queue (works, but may hit transient "queue full" errors)
    pollinations: process.env.POLLINATIONS_API_KEY ? "ok" : "unkeyed",
    anthropic:    process.env.ANTHROPIC_API_KEY    ? "ok" : "missing",
    openai:       process.env.OPENAI_API_KEY       ? "ok" : "missing",
    replicate:    process.env.REPLICATE_API_TOKEN  ? "ok" : "missing",
  });
}
