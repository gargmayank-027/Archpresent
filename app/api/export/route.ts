/**
 * app/api/export/route.ts
 *
 * POST /api/export
 *   body: { projectId }
 *   Returns a streamed PDF file as application/pdf.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import { buildProjectPdf } from "@/lib/pdf";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { projectId } = (await req.json()) as { projectId: string };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const pdfBuffer = await buildProjectPdf(project);

    const slug = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${slug}-concept.pdf"`,
        "Content-Length": String(pdfBuffer.byteLength),
      },
    });
  } catch (err) {
    console.error("[POST /api/export]", err);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
