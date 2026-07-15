/**
 * app/api/projects/[id]/route.ts
 *
 * GET    /api/projects/[id]  → fetch a single project
 * PATCH  /api/projects/[id]  → confirm which floor (planPages[] entry) to proceed with
 * DELETE /api/projects/[id]  → delete a project permanently
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await projectStore.get(params.id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, {
      status: 404,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  }
  return NextResponse.json({ project }, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const project = await projectStore.get(params.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await req.json();

    // Floor selection (existing behavior)
    if (body.selectedPageIndex !== undefined) {
      const page = project.planPages?.[body.selectedPageIndex];
      if (!page) {
        return NextResponse.json({ error: "No such page on this project" }, { status: 400 });
      }
      const updated = await projectStore.update(params.id, {
        selectedPageIndex: body.selectedPageIndex,
        floorSelectionConfirmed: true,
        planImageUrl:  page.imageUrl,
        planImagePath: page.imagePath,
        analysis: undefined,
        planStrengths: undefined,
        status: "created",
      });
      return NextResponse.json({ project: updated });
    }

    // General field updates (theme, name, etc.)
    const allowedFields = ["presentationTheme", "name", "clientName", "roomNarratives", "editedStrengths"];
    const patch: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) patch[field] = body[field];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await projectStore.update(params.id, patch);
    return NextResponse.json({ project: updated });
  } catch (err) {
    console.error("[PATCH /api/projects/[id]]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const project = await projectStore.get(params.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await projectStore.delete(params.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/projects/[id]]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
