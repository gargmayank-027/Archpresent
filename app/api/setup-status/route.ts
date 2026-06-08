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
    gemini:    process.env.GOOGLE_AI_KEY    ? "ok" : "missing",
    hf:        process.env.HF_TOKEN         ? "ok" : "missing",
    anthropic: process.env.ANTHROPIC_API_KEY? "ok" : "missing",
    openai:    process.env.OPENAI_API_KEY   ? "ok" : "missing",
    replicate: process.env.REPLICATE_API_TOKEN ? "ok" : "missing",
  });
}
