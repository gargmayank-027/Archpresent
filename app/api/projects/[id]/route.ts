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
    const { selectedPageIndex } = body as { selectedPageIndex?: number };

    if (selectedPageIndex === undefined) {
      return NextResponse.json({ error: "selectedPageIndex is required" }, { status: 400 });
    }
    const page = project.planPages?.[selectedPageIndex];
    if (!page) {
      return NextResponse.json({ error: "No such page on this project" }, { status: 400 });
    }

    // Switching floors invalidates any prior analysis/moodboards run against
    // the previously-selected page — clear them out rather than leaving
    // stale room data attached to a different floor plan.
    const updated = await projectStore.update(params.id, {
      selectedPageIndex,
      floorSelectionConfirmed: true,
      planImageUrl:  page.imageUrl,
      planImagePath: page.imagePath,
      analysis: undefined,
      planStrengths: undefined,
      status: "created",
    });

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
