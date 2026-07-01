/**
 * app/api/projects/[id]/route.ts
 *
 * GET    /api/projects/[id]  → fetch a single project
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
