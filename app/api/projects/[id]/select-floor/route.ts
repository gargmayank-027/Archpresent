/**
 * app/api/projects/[id]/select-floor/route.ts
 *
 * POST /api/projects/[id]/select-floor
 *   multipart/form-data: { selectedPageIndex (number), planImage (PNG File) }
 *
 * The client renders the selected PDF page to a canvas at high resolution
 * and uploads the resulting PNG here. This becomes the project's active
 * plan image — a raster PNG that everything downstream (AI analysis,
 * enhancement, cropping, PDF export) can work with, no server-side PDF
 * rendering needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore, saveUploadedFile } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const project = await projectStore.get(params.id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const selectedPageIndex = Number(formData.get("selectedPageIndex") ?? -1);
    const planImage = formData.get("planImage") as File | null;

    if (selectedPageIndex < 0) {
      return NextResponse.json({ error: "selectedPageIndex is required" }, { status: 400 });
    }
    if (!planImage || !(planImage instanceof File)) {
      return NextResponse.json({ error: "planImage (PNG file) is required" }, { status: 400 });
    }

    const page = project.planPages?.[selectedPageIndex];
    if (!page) {
      return NextResponse.json({ error: "No such page on this project" }, { status: 400 });
    }

    // Save the client-rendered PNG as the plan image
    const buffer = Buffer.from(await planImage.arrayBuffer());
    const filename = `plan-${params.id}-floor${selectedPageIndex + 1}.png`;
    const { url, diskPath } = await saveUploadedFile(buffer, filename);

    // Switching floors invalidates any prior analysis/moodboards
    const updated = await projectStore.update(params.id, {
      selectedPageIndex,
      floorSelectionConfirmed: true,
      planImageUrl: url,
      planImagePath: diskPath,
      analysis: undefined,
      planStrengths: undefined,
      status: "created",
    });

    return NextResponse.json({ project: updated });
  } catch (err) {
    console.error("[POST /api/projects/[id]/select-floor]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
