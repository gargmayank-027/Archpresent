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
import { splitPdfPages } from "@/lib/pdfRaster";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Project, PlotInfo, PlotFacing, PropertyType, FloorLocation, PlanPage } from "@/types";

export const runtime = "nodejs";

/** Get the current user's identifiers for project matching */
async function getUserIdentifiers(): Promise<{ id: string | null; email: string | null }> {
  try {
    const session = await getServerSession(authOptions);
    return {
      id: (session?.user as any)?.id ?? null,
      email: session?.user?.email ?? null,
    };
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
    const allowedTypes = ["image/png", "image/jpeg", "application/pdf"];
    if (!allowedTypes.includes(planFile.type)) {
      return NextResponse.json(
        { error: "Plan must be PNG, JPEG, or PDF." },
        { status: 400 }
      );
    }

    // ── Parse plot / site context fields ────────────────────────────────────
    const plotInfo: PlotInfo = {};

    const cityRaw          = formData.get("city");
    const stateRaw         = formData.get("state");
    const countryRaw       = formData.get("country");
    const plotAreaRaw      = formData.get("plotAreaSqm");
    const builtUpAreaRaw   = formData.get("builtUpAreaSqm");
    const facingRaw        = formData.get("facing");
    const propertyTypeRaw  = formData.get("propertyType");
    const bedroomsRaw      = formData.get("numberOfBedrooms");
    const floorsRaw        = formData.get("numberOfFloors");
    const floorLocRaw      = formData.get("floorLocation");
    const vaastuRaw        = formData.get("vaastuCompliance");
    const notesRaw         = formData.get("additionalNotes");

    if (cityRaw && String(cityRaw).trim())       plotInfo.city    = String(cityRaw).trim();
    if (stateRaw && String(stateRaw).trim())     plotInfo.state   = String(stateRaw).trim();
    if (countryRaw && String(countryRaw).trim())  plotInfo.country = String(countryRaw).trim();

    // Client brief
    const familyDetailsRaw = formData.get("familyDetails");
    const lifestyleRaw     = formData.get("lifestyle");
    const prioritiesRaw    = formData.get("priorities");
    const showVastuRaw     = formData.get("showVastu");
    if (familyDetailsRaw && String(familyDetailsRaw).trim()) plotInfo.familyDetails = String(familyDetailsRaw).trim();
    if (lifestyleRaw && String(lifestyleRaw).trim())         plotInfo.lifestyle = String(lifestyleRaw).trim();
    if (prioritiesRaw && String(prioritiesRaw).trim())       plotInfo.priorities = String(prioritiesRaw).trim();
    if (showVastuRaw === "true")                             plotInfo.showVastu = true;

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

    let planImageUrl: string;
    let planImagePath: string;
    let planPages: PlanPage[] | undefined;
    let selectedPageIndex: number | undefined;
    let floorSelectionConfirmed = true;

    if (planFile.type === "application/pdf") {
      // Rasterise every page up front. A PDF might be a single floor plan,
      // or it might contain several floors (ground/first/second…) — we
      // don't know until we look, so split unconditionally and let the
      // Review step ask the architect which floor to proceed with when
      // there's more than one.
      let pageBuffers: Buffer[];
      try {
        pageBuffers = await splitPdfPages(buffer);
      } catch (err) {
        console.error("[POST /api/projects] PDF splitting failed:", err);
        return NextResponse.json(
          { error: "Could not read this PDF. Please make sure it isn't password-protected or corrupted, or export it as PNG/JPEG instead." },
          { status: 400 }
        );
      }
      if (pageBuffers.length === 0) {
        return NextResponse.json({ error: "No pages found in this PDF." }, { status: 400 });
      }

      // Store each page as a single-page PDF. The client-side floor picker
      // will render these to canvas (using pdfjs-dist in the browser) and
      // upload a PNG of the selected floor — that PNG becomes the plan image
      // used for AI analysis, cropping, and everything downstream.
      planPages = [];
      for (let i = 0; i < pageBuffers.length; i++) {
        const { url, diskPath } = await saveUploadedFile(pageBuffers[i], `plan-${id}-page${i + 1}.pdf`);
        planPages.push({ pageNumber: i + 1, imageUrl: url, imagePath: diskPath });
      }

      // Default to page 1 so the project always has a valid active plan,
      // even before the architect confirms a floor. If there's only one
      // page there's nothing to choose, so treat it as already confirmed.
      selectedPageIndex = 0;
      planImageUrl  = planPages[0].imageUrl;
      planImagePath = planPages[0].imagePath;
      floorSelectionConfirmed = planPages.length === 1;
    } else {
      const saved = await saveUploadedFile(buffer, filename);
      planImageUrl  = saved.url;
      planImagePath = saved.diskPath;
    }

    // ── Create project ──────────────────────────────────────────────────────
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
      ...(planPages ? { planPages, selectedPageIndex, floorSelectionConfirmed } : {}),
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
    const { id: userId, email } = await getUserIdentifiers();
    const allProjects = await projectStore.list();

    let projects;
    if (userId || email) {
      // Show projects that match by userId, email, OR have no owner (unclaimed).
      // This handles:
      //  - Normal case: userId matches
      //  - Session changed: email still matches even if userId differs
      //  - Pre-auth projects: no userId field → shown to the current user
      projects = allProjects.filter((p) =>
        !p.userId ||                         // unclaimed (pre-auth)
        p.userId === userId ||               // exact userId match
        p.userId === email ||                // userId stored as email
        (email && p.userId === email)         // cross-match
      );
    } else {
      projects = allProjects;
    }

    return NextResponse.json({ projects }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch (err) {
    console.error("[GET /api/projects]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
