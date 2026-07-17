/**
 * app/api/cad/render/route.ts
 *
 * POST /api/cad/render
 *   json: { projectId, theme }
 *   -> { renderedPlanUrl, cadTheme, rooms, warnings }
 *
 * Re-renders a CAD-origin project's stored DXF under a different theme.
 * Synchronous — V1 has no AI step in the render path, so there's nothing
 * to queue (architecture doc §8, "most V1 renders are synchronous").
 *
 * This is the CAD-path analog of `POST /api/render-plan/upload`, but
 * that route is untouched — this is a new, isolated route (migration
 * plan §2.3/§2.9).
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore, saveUploadedFile } from "@/lib/store";
import { renderCadPlan } from "@/lib/cadClient";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, theme } = body as { projectId?: string; theme?: string };

    if (!projectId || !theme) {
      return NextResponse.json({ error: "projectId and theme are required" }, { status: 400 });
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.sourceType !== "cad" || !project.cadFileUrl) {
      return NextResponse.json(
        { error: "This project has no CAD source file to re-render from." },
        { status: 400 }
      );
    }

    // Fetch the originally-uploaded DXF back from storage.
    const dxfRes = await fetch(project.cadFileUrl);
    if (!dxfRes.ok) {
      return NextResponse.json({ error: "Could not retrieve the stored CAD file." }, { status: 500 });
    }
    const dxfBuffer = Buffer.from(await dxfRes.arrayBuffer());

    let cadResult;
    try {
      cadResult = await renderCadPlan(dxfBuffer, "reupload.dxf", theme);
    } catch (err) {
      console.error("[POST /api/cad/render] CAD pipeline failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Re-render failed." },
        { status: 422 }
      );
    }

    let renderedPlanUrl: string;
    try {
      const sharp = (await import("sharp")).default;
      const pngBuffer = await sharp(Buffer.from(cadResult.svg)).png().toBuffer();
      const saved = await saveUploadedFile(pngBuffer, `cad-${projectId}-rendered-${Date.now()}.png`);
      renderedPlanUrl = saved.url;
    } catch (err) {
      console.error("[POST /api/cad/render] rasterization failed, falling back to SVG:", err);
      const saved = await saveUploadedFile(Buffer.from(cadResult.svg), `cad-${projectId}-rendered-${Date.now()}.svg`);
      renderedPlanUrl = saved.url;
    }

    const rooms = cadResult.rooms.map((r) => ({
      name: r.name,
      sizeEstimateSqm: r.sizeEstimateSqm ?? undefined,
      boundingBox: r.boundingBox,
      roomType: r.roomType,
      classificationConfidence: r.classificationConfidence,
    }));

    await projectStore.update(projectId, {
      renderedPlanUrl,
      planImageUrl: renderedPlanUrl,
      cadTheme: cadResult.theme,
      cadWarnings: cadResult.warnings,
      analysis: { ...(project.analysis ?? { rooms: [] }), rooms },
    });

    return NextResponse.json({
      renderedPlanUrl,
      cadTheme: cadResult.theme,
      rooms,
      warnings: cadResult.warnings,
    });
  } catch (err) {
    console.error("[POST /api/cad/render]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
