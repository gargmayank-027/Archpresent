/**
 * app/api/analyze/route.ts
 *
 * POST /api/analyze
 *   body: { projectId, strengths? }
 *
 * Fully defensive — each step is isolated so one failure
 * doesn't mask another. Returns detailed error messages.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore } from "@/lib/store";
import { analyzePlanImage, generatePlanStrengths } from "@/lib/ai";
import { enhancePlanImage } from "@/lib/enhance";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let projectId = "";

  try {
    const body = await req.json();
    projectId = body.projectId ?? "";
    const strengths: string[] | undefined = body.strengths;
    const editedAnalysis = body.analysis ?? null;

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    // ── Load project ──────────────────────────────────────────────────────
    const project = await projectStore.get(projectId);
    if (!project) {
      return NextResponse.json({ error: `Project not found: ${projectId}` }, { status: 404 });
    }

    console.log(`[analyze] Starting for project: ${project.name} (${projectId})`);

    // ── Mode 2: save edited strengths + optional edited analysis ──────────
    if (strengths !== undefined) {
      const updated = await projectStore.update(projectId, {
        planStrengths: strengths,
        ...(editedAnalysis ? { analysis: editedAnalysis } : {}),
        status: "analyzed",
      });
      return NextResponse.json({ analysis: updated.analysis, strengths: updated.planStrengths });
    }

    // ── Mode 1: enhance + analyse ─────────────────────────────────────────

    // Step A — check image is accessible (disk path or blob URL)
    const isRemote = project.planImagePath.startsWith("http");
    if (!isRemote) {
      const { existsSync } = await import("fs");
      if (!existsSync(project.planImagePath)) {
        console.error(`[analyze] Image file missing: ${project.planImagePath}`);
        return NextResponse.json({
          error: `Plan image file not found. Try re-uploading the plan.`,
        }, { status: 500 });
      }
    }
    console.log(`[analyze] Image found: ${isRemote ? "remote" : "local"} — ${project.planImagePath}`);

    // Step B — enhance image (Sharp). Never hard-fails — returns original on error.
    let enhanced;
    try {
      enhanced = await enhancePlanImage(project.planImagePath, projectId);
      console.log(`[analyze] Enhancement: ${enhanced.processingNotes.join(", ")}`);
    } catch (enhErr) {
      console.error("[analyze] Enhancement threw unexpectedly:", enhErr);
      // Fall back to original image — don't abort the whole flow
      enhanced = {
        originalUrl:      project.planImageUrl,
        enhancedUrl:      project.planImageUrl,
        enhancedDiskPath: project.planImagePath,
        processingNotes:  [`Enhancement error: ${String(enhErr)}`],
      };
    }

    // Save enhanced image back to project
    await projectStore.update(projectId, {
      planImageUrl:  enhanced.enhancedUrl,
      planImagePath: enhanced.enhancedDiskPath,
      ...(enhanced.originalUrl !== enhanced.enhancedUrl
        ? { originalPlanImageUrl: enhanced.originalUrl }
        : {}),
    });

    // Step C — AI analysis
    // On Vercel, enhancedUrl is a blob URL (https://...) — pass directly.
    // Locally, it's /uploads/... — loadImageAsBase64 reads it from disk.
    const imageUrlForAI = enhanced.enhancedUrl;

    // Block PDFs — Sharp on most systems cannot rasterise them.
    // AutoCAD exports clean PNGs in 2 clicks: Plot → PNG printer.
    const isPdf = project.planImagePath.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      return NextResponse.json({
        error: "PDF plans cannot be analysed. Please export your floor plan as PNG or JPEG from AutoCAD (Plot → PNG/JPEG printer) and create a new project with that file.",
      }, { status: 400 });
    }

    console.log(`[analyze] Running AI analysis on: ${imageUrlForAI}`);
    let analysis;
    try {
      analysis = await analyzePlanImage(imageUrlForAI, project.plotInfo);
      console.log(`[analyze] Analysis done — ${analysis.rooms.length} rooms detected`);
    } catch (aiErr) {
      console.error("[analyze] AI analysis failed:", aiErr);
      const errMsg = String(aiErr);
      const userMsg = errMsg.includes("429")
        ? "Gemini rate limit hit. Please wait 60 seconds and try again."
        : errMsg.includes("400")
        ? "Gemini could not read the image. Make sure you uploaded a clear PNG or JPEG (not a PDF or scanned photo)."
        : `AI analysis failed: ${errMsg}`;
      return NextResponse.json({ error: userMsg }, { status: 500 });
    }

    // Step D — generate plan strengths
    console.log("[analyze] Generating plan strengths…");
    let planStrengths: string[];
    try {
      planStrengths = await generatePlanStrengths(analysis, project.plotInfo);
      console.log(`[analyze] ${planStrengths.length} strengths generated`);
    } catch (strErr) {
      console.error("[analyze] Strengths generation failed:", strErr);
      // Non-fatal — use fallback bullets
      planStrengths = [
        "Well-proportioned rooms make efficient use of the available floor area.",
        "Clear separation of social and private zones supports comfortable daily living.",
        "Natural light access has been considered in the layout of key living spaces.",
      ];
    }

    // Step E — persist final result
    await projectStore.update(projectId, {
      analysis,
      planStrengths,
      status: "analyzed",
    });

    console.log(`[analyze] Complete for project ${projectId}`);

    return NextResponse.json({
      analysis,
      strengths: planStrengths,
      enhancement: enhanced.processingNotes,
    });

  } catch (err) {
    // Top-level catch — should rarely hit now that each step is isolated
    console.error(`[analyze] Unhandled error for project ${projectId}:`, err);
    return NextResponse.json({
      error: `Unexpected error: ${String(err)}`,
    }, { status: 500 });
  }
}
