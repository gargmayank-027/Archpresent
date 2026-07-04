/**
 * POST /api/render-plan
 *   { projectId }
 *   → { renderedPlanUrl }
 *
 * Generates a color-coded floor plan using the project's room detection
 * data and saves it. Can be called after analysis to create the rendered
 * version, or re-called to regenerate if rooms change.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import { renderAndSavePlan } from "@/lib/planRenderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!project.analysis?.rooms?.length) {
      return NextResponse.json({ error: "No room analysis data — analyse the plan first" }, { status: 400 });
    }

    const roomsWithBoxes = project.analysis.rooms.filter((r) => r.boundingBox);
    if (roomsWithBoxes.length === 0) {
      return NextResponse.json({ error: "No room bounding boxes detected — re-analyse the plan" }, { status: 400 });
    }

    const renderedPlanUrl = await renderAndSavePlan(
      project.planImagePath,
      project.id,
      project.analysis.rooms,
      project.plotInfo
    );

    // Persist on the project
    await projectStore.update(projectId, { renderedPlanUrl });

    return NextResponse.json({ renderedPlanUrl });
  } catch (err) {
    console.error("[POST /api/render-plan]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
