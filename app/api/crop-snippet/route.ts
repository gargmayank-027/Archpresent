/**
 * app/api/crop-snippet/route.ts
 *
 * POST /api/crop-snippet
 *   { projectId, roomName, boundingBox: { x, y, width, height } }
 *
 * Re-crops a room's plan snippet using manually-adjusted bounding box
 * coordinates (normalised 0-1). Updates the room's planSnippetUrl in the
 * project's roomMoodboards array and persists the manual bounding box
 * override in the room's analysis data so it survives regeneration.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import { cropRoomFromPlan } from "@/lib/planCrop";
import type { RoomBoundingBox } from "@/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { projectId, roomName, boundingBox } = await req.json() as {
      projectId: string;
      roomName: string;
      boundingBox: RoomBoundingBox;
    };

    if (!projectId || !roomName || !boundingBox) {
      return NextResponse.json({ error: "projectId, roomName, and boundingBox are required" }, { status: 400 });
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Use the enhanced plan image if available, otherwise the original
    const planPath = project.planImagePath;

    // Re-crop with the manual bounding box
    const snippetUrl = await cropRoomFromPlan(planPath, roomName, projectId, boundingBox);

    if (!snippetUrl) {
      return NextResponse.json({ error: "Crop failed — the region may be too small or the image unreadable" }, { status: 400 });
    }

    // Update the roomMoodboard entry with the new snippet
    const updatedMoodboards = (project.roomMoodboards ?? []).map((rm) =>
      rm.roomName === roomName ? { ...rm, planSnippetUrl: snippetUrl } : rm
    );

    // Also persist the manual bounding box override in the analysis rooms
    // so that future regenerations (which re-run cropRoomFromPlan) use
    // the manual box instead of the AI-detected one.
    const updatedRooms = (project.analysis?.rooms ?? []).map((r) =>
      r.name === roomName ? { ...r, boundingBox, manualCropOverride: true } : r
    );

    await projectStore.update(projectId, {
      roomMoodboards: updatedMoodboards,
      analysis: project.analysis ? { ...project.analysis, rooms: updatedRooms } : undefined,
    });

    return NextResponse.json({ snippetUrl });
  } catch (err) {
    console.error("[POST /api/crop-snippet]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
