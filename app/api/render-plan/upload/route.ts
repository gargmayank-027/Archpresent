/**
 * POST /api/render-plan/upload
 *   multipart/form-data: { projectId, renderedPlan (PNG File) }
 *
 * Saves the client-rendered (flood-filled) plan PNG and updates the
 * project's renderedPlanUrl. This is called after the FloodFillRenderer
 * component finishes rendering in the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore, saveUploadedFile } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const projectId = formData.get("projectId") as string | null;
    const renderedPlan = formData.get("renderedPlan") as File | null;

    if (!projectId || !renderedPlan) {
      return NextResponse.json({ error: "projectId and renderedPlan are required" }, { status: 400 });
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const buffer = Buffer.from(await renderedPlan.arrayBuffer());
    const filename = `plan-${projectId}-rendered.png`;
    const { url } = await saveUploadedFile(buffer, filename);

    // Cache-bust to avoid stale renders
    const renderedPlanUrl = url + (url.includes("?") ? "&" : "?") + "v=" + Date.now();

    await projectStore.update(projectId, { renderedPlanUrl });

    return NextResponse.json({ renderedPlanUrl });
  } catch (err) {
    console.error("[POST /api/render-plan/upload]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
