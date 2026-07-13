/**
 * app/api/feedback/route.ts
 *
 * POST — submit client feedback on a shared presentation
 *   { shareToken, clientName?, reaction, comment?, slideIndex? }
 *
 * GET  — retrieve all feedback for a project (authenticated)
 *   ?projectId=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { shareToken, clientName, reaction, comment, slideIndex } = await req.json();
    if (!shareToken) return NextResponse.json({ error: "shareToken required" }, { status: 400 });

    // Find the project by share token
    const all = await projectStore.list();
    const project = all.find((p) => p.shareToken === shareToken && p.shareEnabled !== false);
    if (!project) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    // Build feedback entry
    const entry = {
      id: crypto.randomUUID().slice(0, 8),
      clientName: clientName?.trim() || "Client",
      reaction: reaction || null,         // "love" | "like" | "neutral" | "concern"
      comment: comment?.trim() || null,
      slideIndex: slideIndex ?? null,
      createdAt: new Date().toISOString(),
    };

    // Append to project's feedback array
    const feedback = [...(project.clientFeedback ?? []), entry];
    await projectStore.update(project.id, { clientFeedback: feedback });

    return NextResponse.json({ success: true, entry });
  } catch (err) {
    console.error("[POST /api/feedback]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const project = await projectStore.get(projectId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ feedback: project.clientFeedback ?? [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
