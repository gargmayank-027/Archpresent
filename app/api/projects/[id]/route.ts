/**
 * app/api/projects/[id]/route.ts
 *
 * GET /api/projects/[id]  → fetch a single project
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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}
