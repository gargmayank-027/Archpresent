/**
 * POST /api/projects/duplicate
 *   { projectId }
 *   → { project } (the new duplicate)
 *
 * Copies a project with all its analysis intact but clears moodboards,
 * share state, and rendered plan. The user can then apply a different
 * style direction without re-uploading and re-analysing the plan.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { projectStore } from "@/lib/store";
import type { Project } from "@/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const source = await projectStore.get(projectId);
    if (!source) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const newId = randomUUID();
    const duplicate: Project = {
      ...source,
      id: newId,
      name: `${source.name} (copy)`,
      createdAt: new Date().toISOString(),

      // Keep analysis + plan — the whole point of duplicating
      // planImageUrl, planImagePath, analysis, planStrengths all preserved

      // Clear moodboards — user will pick a new style
      styleProfile: undefined,
      moodboards: undefined,
      overallMoodboard: undefined,
      roomMoodboards: undefined,

      // Clear rendered plan — will be regenerated
      renderedPlanUrl: undefined,
      aiRenderedPlanUrl: undefined,

      // Clear share state — new project, new link
      shareToken: undefined,
      shareEnabled: undefined,
      shareExpiresAt: undefined,
      shareViewCount: undefined,
      shareLastViewedAt: undefined,

      // Reset status to analyzed (skip upload+review, go straight to moodboards)
      status: source.analysis ? "analyzed" : "created",
    };

    await projectStore.create(duplicate);

    return NextResponse.json({ project: duplicate }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/projects/duplicate]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
