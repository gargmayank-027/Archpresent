/**
 * app/api/cad/upload/route.ts
 *
 * POST /api/cad/upload
 *   multipart/form-data: { name, clientName, firmName, plan (File: .dxf),
 *                           presentationType?, ...plotInfo fields (same as /api/projects) }
 *   -> { project }
 *
 * This is the CAD-path sibling of `POST /api/projects` (migration plan
 * §2.9 / Phase 3). It does NOT touch `/api/projects` or `/api/analyze` —
 * a completely new, isolated route, so the existing image-upload flow
 * carries zero risk from this addition (migration plan §5.1).
 *
 * Unlike the image path, a CAD project needs no separate "Analyze" step:
 * room geometry and classification come directly from the DXF, so this
 * route produces a fully `analyzed`-equivalent project in one call.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { projectStore, saveUploadedFile } from "@/lib/store";
import { renderCadPlan } from "@/lib/cadClient";
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
      return NextResponse.json({ error: "A CAD plan file (.dxf) is required" }, { status: 400 });
    }

    const lowerName = planFile.name.toLowerCase();
    if (!lowerName.endsWith(".dxf")) {
      // .dwg would need the ODA File Converter step (architecture doc §1.4,
      // module M28) — deliberately out of scope for this MVP pass.
      return NextResponse.json(
        { error: "Only .dxf files are supported right now. DWG support (via DXF conversion) is planned." },
        { status: 400 }
      );
    }
    if (planFile.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 20 MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await planFile.arrayBuffer());

    const unitOverrideRaw = formData.get("unitOverride");
    const unitOverride = unitOverrideRaw && String(unitOverrideRaw).trim()
      ? String(unitOverrideRaw).trim()
      : undefined;

    // ── Run the CAD pipeline ────────────────────────────────────────────
    let cadResult;
    try {
      cadResult = await renderCadPlan(buffer, planFile.name, "modern", { unitOverride });
    } catch (err) {
      console.error("[POST /api/cad/upload] CAD pipeline failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not process this DXF file." },
        { status: 422 }
      );
    }

    // ── Persist the original DXF, the rendered SVG, a rasterized PNG, and
    //    the IR JSON — all via the SAME storage adapter every other upload
    //    path already uses (lib/store.ts is untouched, per migration plan §2.7). ──
    const id = randomUUID();

    const { url: cadFileUrl } = await saveUploadedFile(buffer, `cad-${id}.dxf`);
    const { url: cadIrUrl } = await saveUploadedFile(Buffer.from(cadResult.irJson), `cad-${id}-ir.json`);

    // Master artifact is SVG (architecture doc §6.3); PNG is derived from
    // it via `sharp`, which is already a project dependency (used by
    // lib/planRenderer.ts and lib/enhance.ts) — no new dependency added.
    let planImageUrl: string;
    let planImagePath: string;
    try {
      const sharp = (await import("sharp")).default;
      const pngBuffer = await sharp(Buffer.from(cadResult.svg)).png().toBuffer();
      const saved = await saveUploadedFile(pngBuffer, `cad-${id}-rendered.png`);
      planImageUrl = saved.url;
      planImagePath = saved.diskPath;
    } catch (err) {
      console.error("[POST /api/cad/upload] SVG->PNG rasterization failed, falling back to raw SVG URL:", err);
      const saved = await saveUploadedFile(Buffer.from(cadResult.svg), `cad-${id}-rendered.svg`);
      planImageUrl = saved.url;
      planImagePath = saved.diskPath;
    }

    // ── Parse plot / site context fields (identical to /api/projects) ─────
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
    const rooms: RoomDetail[] = cadResult.rooms.map((r) => ({
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
      renderedPlanUrl: planImageUrl, // CAD output is already the "rendered" (colored/themed) plan
      plotInfo: Object.keys(plotInfo).length > 0 ? plotInfo : undefined,
      status: "analyzed", // no separate analyze step needed — see file header
      analysis: { rooms },
      sourceType: "cad",
      cadFileUrl,
      cadIrUrl,
      cadTheme: cadResult.theme,
      cadWarnings: cadResult.warnings,
      cadUnitOverride: unitOverride,
      cadUnmappedBlockNames: cadResult.unmappedBlockNames,
    };

    await projectStore.create(project);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/cad/upload]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
