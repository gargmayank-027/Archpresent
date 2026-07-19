/**
 * app/api/pdf-plan/upload/route.ts
 *
 * POST /api/pdf-plan/upload
 *   multipart/form-data: { name, clientName, firmName, plan (File: .pdf),
 *                           scaleOverride?, page?, presentationType?,
 *                           ...plotInfo fields (same as /api/projects) }
 *   -> { project }
 *
 * This is the vector-PDF-engine sibling of `POST /api/cad/upload` — a
 * completely new, isolated route mirroring that file's own isolation
 * rationale almost line for line. It does NOT touch `/api/projects`,
 * `/api/analyze`, or `/api/cad/upload` — the existing image-upload and
 * DXF-upload flows carry zero risk from this addition.
 *
 * Like the CAD path, a PDF-vector project needs no separate "Analyze"
 * step: room geometry and classification come directly from the PDF's
 * vector paths, so this route produces a fully `analyzed`-equivalent
 * project in one call. Unlike the CAD path, a raster/scanned PDF is a
 * real, expected failure mode here (see lib/pdfClient.ts's
 * `isRasterUnsupportedError`) — surfaced as a specific, actionable error
 * message rather than a generic one, since the existing image-upload
 * path already handles scanned/raster plans just fine.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { projectStore, saveUploadedFile } from "@/lib/store";
import { renderPdfPlan, isRasterUnsupportedError, PdfServiceError } from "@/lib/pdfClient";
import { rasterizeCadSvgToPng } from "@/lib/cadSvgRaster";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Project, PlotInfo, PlotFacing, PropertyType, FloorLocation, RoomDetail } from "@/types";

export const runtime = "nodejs";

async function getUserIdentifiers(): Promise<{ id: string | null; email: string | null }> {
  try {
    const session = await getServerSession(authOptions);
    return { id: (session?.user as any)?.id ?? null, email: session?.user?.email ?? null };
  } catch {
    return { id: null, email: null };
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const name       = formData.get("name") as string | null;
    const clientName = formData.get("clientName") as string | null;
    const firmName   = formData.get("firmName") as string | null;
    const planFile   = formData.get("plan") as File | null;

    if (!name || !clientName || !firmName) {
      return NextResponse.json({ error: "name, clientName, and firmName are required" }, { status: 400 });
    }
    if (!planFile) {
      return NextResponse.json({ error: "A PDF plan file is required" }, { status: 400 });
    }

    const lowerName = planFile.name.toLowerCase();
    if (!lowerName.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only .pdf files are supported by the vector-PDF engine. For PNG/JPEG, use the standard upload." },
        { status: 400 }
      );
    }
    if (planFile.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 20 MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await planFile.arrayBuffer());

    const scaleOverrideRaw = formData.get("scaleOverride");
    const scaleOverride = scaleOverrideRaw && String(scaleOverrideRaw).trim()
      ? String(scaleOverrideRaw).trim()
      : undefined;

    const pageRaw = formData.get("page");
    const page = pageRaw !== null && String(pageRaw).trim() !== "" ? Number(pageRaw) : undefined;

    // ── Run the PDF vector pipeline ─────────────────────────────────────
    let pdfResult;
    try {
      pdfResult = await renderPdfPlan(buffer, planFile.name, "modern", { scaleOverride, page });
    } catch (err) {
      console.error("[POST /api/pdf-plan/upload] PDF pipeline failed:", err);
      if (isRasterUnsupportedError(err)) {
        return NextResponse.json(
          {
            error:
              "This PDF looks like a scanned image rather than a vector-drawn plan, so the " +
              "vector-PDF engine can't parse it. Try the standard PDF/image upload instead — " +
              "it uses AI analysis, which works on scans.",
            code: "raster_unsupported",
          },
          { status: 422 }
        );
      }
      const message = err instanceof PdfServiceError ? err.message
        : err instanceof Error ? err.message : "Could not process this PDF file.";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // ── Persist the original PDF, the rendered SVG, a rasterized PNG, and
    //    the IR JSON — all via the SAME storage adapter every other upload
    //    path already uses (lib/store.ts is untouched). ──────────────────
    const id = randomUUID();

    const { url: pdfFileUrl } = await saveUploadedFile(buffer, `pdfplan-${id}.pdf`);
    const { url: pdfIrUrl } = await saveUploadedFile(Buffer.from(pdfResult.irJson), `pdfplan-${id}-ir.json`);

    // Master artifact is SVG, same as the CAD path — PNG is derived from
    // it via the SAME rasterizer (lib/cadSvgRaster.ts is source-agnostic:
    // it only reads the SVG's own declared width="Xmm" height="Ymm", which
    // svg_renderer.py emits identically for both engines).
    let planImageUrl: string;
    let planImagePath: string;
    try {
      const pngBuffer = await rasterizeCadSvgToPng(pdfResult.svg);
      const saved = await saveUploadedFile(pngBuffer, `pdfplan-${id}-rendered.png`);
      planImageUrl = saved.url;
      planImagePath = saved.diskPath;
    } catch (err) {
      console.error("[POST /api/pdf-plan/upload] SVG->PNG rasterization failed, falling back to raw SVG URL:", err);
      const saved = await saveUploadedFile(Buffer.from(pdfResult.svg), `pdfplan-${id}-rendered.svg`);
      planImageUrl = saved.url;
      planImagePath = saved.diskPath;
    }

    // ── Parse plot / site context fields (identical to /api/projects and
    //    /api/cad/upload) ────────────────────────────────────────────────
    const plotInfo: PlotInfo = {};
    const cityRaw = formData.get("city");
    const stateRaw = formData.get("state");
    const countryRaw = formData.get("country");
    if (cityRaw && String(cityRaw).trim()) plotInfo.city = String(cityRaw).trim();
    if (stateRaw && String(stateRaw).trim()) plotInfo.state = String(stateRaw).trim();
    if (countryRaw && String(countryRaw).trim()) plotInfo.country = String(countryRaw).trim();

    const familyDetailsRaw = formData.get("familyDetails");
    const lifestyleRaw = formData.get("lifestyle");
    const prioritiesRaw = formData.get("priorities");
    const showVastuRaw = formData.get("showVastu");
    if (familyDetailsRaw && String(familyDetailsRaw).trim()) plotInfo.familyDetails = String(familyDetailsRaw).trim();
    if (lifestyleRaw && String(lifestyleRaw).trim()) plotInfo.lifestyle = String(lifestyleRaw).trim();
    if (prioritiesRaw && String(prioritiesRaw).trim()) plotInfo.priorities = String(prioritiesRaw).trim();
    if (showVastuRaw === "true") plotInfo.showVastu = true;

    const facingRaw = formData.get("facing");
    const propertyTypeRaw = formData.get("propertyType");
    const floorLocRaw = formData.get("floorLocation");
    if (facingRaw) plotInfo.facing = facingRaw as PlotFacing;
    if (propertyTypeRaw) plotInfo.propertyType = propertyTypeRaw as PropertyType;
    if (floorLocRaw) plotInfo.floorLocation = floorLocRaw as FloorLocation;

    // ── Build the RoomDetail[] the rest of the app already understands ────
    const rooms: RoomDetail[] = pdfResult.rooms.map((r) => ({
      name: r.name,
      sizeEstimateSqm: r.sizeEstimateSqm ?? undefined,
      boundingBox: r.boundingBox,
      roomType: r.roomType,
      classificationConfidence: r.classificationConfidence,
    }));

    const { id: userId, email: userEmail } = await getUserIdentifiers();
    const presTypeRaw = formData.get("presentationType");
    const presentationType = presTypeRaw === "concept" || presTypeRaw === "interior" ? presTypeRaw : undefined;

    const project: Project = {
      id,
      userId: userId ?? userEmail ?? undefined,
      presentationType,
      name,
      clientName,
      firmName,
      createdAt: new Date().toISOString(),
      planImageUrl,
      planImagePath,
      renderedPlanUrl: planImageUrl, // vector-PDF output is already the "rendered" (colored/themed) plan
      plotInfo: Object.keys(plotInfo).length > 0 ? plotInfo : undefined,
      status: "analyzed", // no separate analyze step needed — see file header
      analysis: { rooms },
      sourceType: "pdf_image",
      pdfFileUrl,
      pdfPage: page ?? 0,
      pdfIrUrl,
      pdfTheme: pdfResult.theme,
      pdfWarnings: pdfResult.warnings,
      pdfScaleOverride: scaleOverride,
    };

    await projectStore.create(project);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/pdf-plan/upload]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
