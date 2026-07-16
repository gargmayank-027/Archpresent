/**
 * app/api/export/preview/route.ts
 *
 * GET /api/export/preview?projectId=...
 *
 * Returns the raw, actual generated PDF bytes (application/pdf, inline).
 *
 * Previously this route rasterized the PDF server-side with Sharp and
 * returned page images as JSON. Sharp is unreliable in Vercel's serverless
 * runtime, so that rasterization silently failed there and the UI fell back
 * to a hand-maintained JSX mockup of the deck — which had drifted out of
 * sync with the real PDF layout, so "preview" and "download" showed two
 * different things.
 *
 * Now the client renders these exact bytes with pdf.js in the browser
 * (see app/project/[id]/export/page.tsx). Preview and download are always
 * byte-for-byte the same PDF, generated fresh from current project data on
 * every request — there is no separate code path left to drift.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import { buildProjectPdf } from "@/lib/pdf";

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

    const { bytes: pdfBuffer, pageLabels } = await buildProjectPdf(project);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // Labels emitted by the builder itself, one per actual page. The
        // Export screen used to keep its own parallel `slides` array and index
        // page images against it — which dropped the Thank You page entirely
        // and mislabelled everything after the walkthrough once that started
        // paginating. Shipped as a header to avoid a second round trip.
        "X-Deck-Page-Labels": encodeURIComponent(JSON.stringify(pageLabels)),
        "Access-Control-Expose-Headers": "X-Deck-Page-Labels",
        "Content-Disposition": "inline",
        "Content-Length": String(pdfBuffer.byteLength),
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
      },
    });
  } catch (err) {
    console.error("[GET /api/export/preview]", err);
    return NextResponse.json({ error: "Preview generation failed" }, { status: 500 });
  }
}
