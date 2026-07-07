/**
 * POST /api/ai-render
 *   { projectId }
 *   → { aiRenderedPlanUrl }
 *
 * Generates a photorealistic AI render via HF (free) or Replicate (paid).
 * Downloads the result and saves to permanent storage.
 */

import { NextRequest, NextResponse } from "next/server";
import { projectStore, saveUploadedFile } from "@/lib/store";
import { generateAiRenderedPlan } from "@/lib/aiRender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const project = await projectStore.get(projectId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!project.analysis?.rooms?.length) {
      return NextResponse.json({ error: "Analyse the plan first" }, { status: 400 });
    }

    // Plan URL must be publicly accessible for Replicate
    // For HF, we download it server-side so local paths work too
    let planUrl = project.planImageUrl;
    if (planUrl.startsWith("/")) {
      // Local dev — construct absolute URL
      const host = req.headers.get("host") ?? "localhost:3000";
      const proto = host.includes("localhost") ? "http" : "https";
      planUrl = `${proto}://${host}${planUrl}`;
    }

    console.log(`[ai-render] Starting for: ${project.name}`);

    const resultUrl = await generateAiRenderedPlan(
      planUrl,
      project.analysis.rooms,
      project.plotInfo
    );

    // Save the result to permanent storage
    let buffer: Buffer;
    if (resultUrl.startsWith("data:")) {
      // Data URL from HF — extract base64
      const base64 = resultUrl.split(",")[1];
      buffer = Buffer.from(base64, "base64");
    } else {
      // Regular URL from Replicate — download it
      const imgRes = await fetch(resultUrl);
      if (!imgRes.ok) throw new Error(`Failed to download render: ${imgRes.status}`);
      buffer = Buffer.from(await imgRes.arrayBuffer());
    }

    const filename = `plan-${projectId}-ai-rendered.png`;
    const { url: savedUrl } = await saveUploadedFile(buffer, filename);
    const aiRenderedPlanUrl = savedUrl + "?v=" + Date.now();

    await projectStore.update(projectId, { aiRenderedPlanUrl });

    console.log(`[ai-render] Done: ${(buffer.length / 1024).toFixed(0)}KB`);

    return NextResponse.json({ aiRenderedPlanUrl });
  } catch (err) {
    console.error("[POST /api/ai-render]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
