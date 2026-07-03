/**
 * app/api/export/preview/route.ts
 *
 * GET /api/export/preview?projectId=...
 *
 * Returns the ACTUAL generated PDF, rasterised page-by-page, as base64 JPEG
 * data URIs. The "Review & Export" screen renders these directly instead of
 * a hand-maintained React re-implementation of the deck — so what you see
 * in the browser is a picture of the real PDF, not a second guess at it.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import { buildProjectPdf, rasterizePdfToPageImages } from "@/lib/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const pdfBuffer = await buildProjectPdf(project);

    let pages: string[];
    try {
      const images = await rasterizePdfToPageImages(pdfBuffer, 130);
      pages = images.map((buf) => `data:image/jpeg;base64,${buf.toString("base64")}`);
    } catch (err) {
      // Sharp not available (e.g. some serverless environments) — fail soft
      // so the caller can fall back to the old JSX preview rather than a
      // broken screen.
      console.warn("[export/preview] Rasterisation unavailable:", err);
      return NextResponse.json({ error: "PREVIEW_UNAVAILABLE", pages: [] }, { status: 200 });
    }

    return NextResponse.json({ pages }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch (err) {
    console.error("[GET /api/export/preview]", err);
    return NextResponse.json({ error: "Preview generation failed" }, { status: 500 });
  }
}
