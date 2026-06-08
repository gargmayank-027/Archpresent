/**
 * app/api/projects/route.ts
 *
 * POST /api/projects
 *   multipart/form-data: { name, clientName, firmName, plan (File), ...plotInfo }
 *   → { project }
 *
 * GET /api/projects
 *   → { projects }
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { projectStore, saveUploadedFile } from "@/lib/store";
import type { Project, PlotInfo, PlotFacing, PropertyType, FloorLocation } from "@/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const name       = formData.get("name") as string | null;
    const clientName = formData.get("clientName") as string | null;
    const firmName   = formData.get("firmName") as string | null;
    const planFile   = formData.get("plan") as File | null;

    if (!name || !clientName || !firmName) {
      return NextResponse.json(
        { error: "name, clientName, and firmName are required" },
        { status: 400 }
      );
    }
    if (!planFile) {
      return NextResponse.json(
        { error: "A plan file (PDF or PNG) is required" },
        { status: 400 }
      );
    }

    // ── Validate file type ──────────────────────────────────────────────────
    const allowedTypes = ["image/png", "image/jpeg"];
    if (!allowedTypes.includes(planFile.type)) {
      return NextResponse.json(
        { error: "Plan must be PNG or JPEG. Export from AutoCAD using Plot → PNG printer." },
        { status: 400 }
      );
    }

    // ── Parse plot / site context fields ────────────────────────────────────
    const plotInfo: PlotInfo = {};

    const plotAreaRaw      = formData.get("plotAreaSqm");
    const builtUpAreaRaw   = formData.get("builtUpAreaSqm");
    const facingRaw        = formData.get("facing");
    const propertyTypeRaw  = formData.get("propertyType");
    const bedroomsRaw      = formData.get("numberOfBedrooms");
    const floorsRaw        = formData.get("numberOfFloors");
    const floorLocRaw      = formData.get("floorLocation");
    const vaastuRaw        = formData.get("vaastuCompliance");
    const notesRaw         = formData.get("additionalNotes");

    if (plotAreaRaw)     plotInfo.plotAreaSqm        = Number(plotAreaRaw);
    if (builtUpAreaRaw)  plotInfo.builtUpAreaSqm     = Number(builtUpAreaRaw);
    if (facingRaw)       plotInfo.facing             = facingRaw as PlotFacing;
    if (propertyTypeRaw) plotInfo.propertyType       = propertyTypeRaw as PropertyType;
    if (bedroomsRaw)     plotInfo.numberOfBedrooms   = Number(bedroomsRaw);
    if (floorsRaw)       plotInfo.numberOfFloors     = Number(floorsRaw);
    if (floorLocRaw)     plotInfo.floorLocation      = floorLocRaw as FloorLocation;
    if (vaastuRaw)       plotInfo.vaastuCompliance   = vaastuRaw === "true";
    if (notesRaw && String(notesRaw).trim()) {
      plotInfo.additionalNotes = String(notesRaw).trim();
    }

    // ── Save file ───────────────────────────────────────────────────────────
    const id  = randomUUID();
    const ext = planFile.type === "application/pdf" ? ".pdf"
              : planFile.type === "image/png"        ? ".png"
              : ".jpg";
    const filename = `plan-${id}${ext}`;

    const arrayBuffer = await planFile.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);
    const { url: planImageUrl, diskPath: planImagePath } = await saveUploadedFile(buffer, filename);

    // ── Create project ──────────────────────────────────────────────────────
    const project: Project = {
      id,
      name,
      clientName,
      firmName,
      createdAt: new Date().toISOString(),
      planImageUrl,
      planImagePath,
      plotInfo: Object.keys(plotInfo).length > 0 ? plotInfo : undefined,
      status: "created",
    };

    await projectStore.create(project);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/projects]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const projects = await projectStore.list();
    return NextResponse.json({ projects });
  } catch (err) {
    console.error("[GET /api/projects]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
