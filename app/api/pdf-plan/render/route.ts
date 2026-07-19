/**
 * app/api/pdf-plan/render/route.ts
 *
 * POST /api/pdf-plan/render
 *   json: { projectId, theme, scaleOverride? }
 *   -> { renderedPlanUrl, pdfTheme, rooms, warnings, pdfScaleOverride }
 *
 * Re-renders a vector-PDF-origin project's stored PDF under a different
 * theme and/or a corrected drafting-scale override — the PDF-vector
 * sibling of `POST /api/cad/render`. Synchronous, same reasoning as that
 * file: no AI step in this render path, so there's nothing to queue.
 *
 * `scaleOverride` is optional per-request; if omitted, the project's
 * previously-stored value is reused, so a plain theme change doesn't
 * silently forget a scale correction the architect already made —
 * mirrors /api/cad/render's unitOverride handling exactly.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore, saveUploadedFile } from "@/lib/store";
import { renderPdfPlan, isRasterUnsupportedError, PdfServiceError } from "@/lib/pdfClient";
import { rasterizeCadSvgToPng } from "@/lib/cadSvgRaster";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      theme,
      scaleOverride: scaleOverrideRaw,
    } = body as {
      projectId?: string;
      theme?: string;
      scaleOverride?: string;
    };

    if (!projectId || !theme) {
      return NextResponse.json({ error: "projectId and theme are required" }, { status: 400 });
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.sourceType !== "pdf_image" || !project.pdfFileUrl) {
      return NextResponse.json(
        { error: "This project has no vector-PDF source file to re-render from." },
        { status: 400 }
      );
    }

    // Explicit request value wins; otherwise fall back to whatever was
    // stored from a prior upload/render, so a plain theme change doesn't
    // silently discard an earlier scale correction.
    const scaleOverride = scaleOverrideRaw !== undefined ? scaleOverrideRaw : project.pdfScaleOverride;

    // Fetch the originally-uploaded PDF back from storage.
    const pdfRes = await fetch(project.pdfFileUrl);
    if (!pdfRes.ok) {
      return NextResponse.json({ error: "Could not retrieve the stored PDF file." }, { status: 500 });
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    let pdfResult;
    try {
      pdfResult = await renderPdfPlan(pdfBuffer, "reupload.pdf", theme, {
        scaleOverride,
        page: project.pdfPage ?? 0,
      });
    } catch (err) {
      console.error("[POST /api/pdf-plan/render] PDF pipeline failed:", err);
      if (isRasterUnsupportedError(err)) {
        return NextResponse.json(
          { error: "The stored PDF no longer has usable vector geometry — this shouldn't normally happen for a re-render." },
          { status: 422 }
        );
      }
      const message = err instanceof PdfServiceError ? err.message
        : err instanceof Error ? err.message : "Re-render failed.";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    let renderedPlanUrl: string;
    try {
      const pngBuffer = await rasterizeCadSvgToPng(pdfResult.svg);
      const saved = await saveUploadedFile(pngBuffer, `pdfplan-${projectId}-rendered-${Date.now()}.png`);
      renderedPlanUrl = saved.url;
    } catch (err) {
      console.error("[POST /api/pdf-plan/render] rasterization failed, falling back to SVG:", err);
      const saved = await saveUploadedFile(Buffer.from(pdfResult.svg), `pdfplan-${projectId}-rendered-${Date.now()}.svg`);
      renderedPlanUrl = saved.url;
    }

    const rooms = pdfResult.rooms.map((r) => ({
      name: r.name,
      sizeEstimateSqm: r.sizeEstimateSqm ?? undefined,
      boundingBox: r.boundingBox,
      roomType: r.roomType,
      classificationConfidence: r.classificationConfidence,
    }));

    await projectStore.update(projectId, {
      renderedPlanUrl,
      planImageUrl: renderedPlanUrl,
      pdfTheme: pdfResult.theme,
      pdfWarnings: pdfResult.warnings,
      pdfScaleOverride: scaleOverride,
      analysis: { ...(project.analysis ?? { rooms: [] }), rooms },
    });

    return NextResponse.json({
      renderedPlanUrl,
      pdfTheme: pdfResult.theme,
      rooms,
      warnings: pdfResult.warnings,
      pdfScaleOverride: scaleOverride,
    });
  } catch (err) {
    console.error("[POST /api/pdf-plan/render]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
