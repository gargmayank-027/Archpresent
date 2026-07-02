/**
 * lib/enhance.ts — gracefully skips if sharp is unavailable (Vercel)
 */

import type { EnhancedPlan } from "@/types";
import { saveUploadedFile } from "@/lib/store";

export async function enhancePlanImage(
  planImagePath: string,
  projectId: string
): Promise<EnhancedPlan> {
  const originalUrl = planImagePath.startsWith("http")
    ? planImagePath
    : `/uploads/${planImagePath.split("/").pop()}`;

  if (process.env.ENABLE_PLAN_ENHANCEMENT === "false") {
    return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: ["Enhancement disabled"] };
  }

  // Dynamically import sharp — returns null if not installed
  let sharpFn: ((input: Buffer | string, opts?: object) => import("sharp").Sharp) | null = null;
  try {
    const mod = await import("sharp");
    sharpFn = (mod.default ?? mod) as typeof sharpFn;
  } catch {
    return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: ["Sharp not available — raw image used"] };
  }

  try {
    let inputBuffer: Buffer;
    if (planImagePath.startsWith("http")) {
      const res = await fetch(planImagePath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      inputBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      const { readFileSync, existsSync } = await import("fs");
      if (!existsSync(planImagePath)) {
        return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: ["Image file not found"] };
      }
      inputBuffer = readFileSync(planImagePath);
    }

    const ext = planImagePath.split(".").pop()?.toLowerCase() ?? "";
    const notes: string[] = [];

    if (ext === "pdf") {
      // Rasterise the PDF to a PNG first — without this, planImagePath stays
      // a .pdf forever, and lib/planCrop.ts unconditionally refuses to crop
      // PDF sources. That silently disabled room cropping for every PDF-
      // uploaded plan (the "plans not getting cropped" bug).
      //
      // Note: in the normal flow, app/api/projects/route.ts already splits
      // PDF uploads into per-page PNGs at upload time, so planImagePath
      // should never actually be a .pdf here — this is a defensive fallback
      // for any path that bypasses that step.
      try {
        const { rasterizePdfFirstPage } = await import("@/lib/pdfRaster");
        inputBuffer = await rasterizePdfFirstPage(inputBuffer, 2.8);
        notes.push("PDF rasterised to PNG");
      } catch (err) {
        console.error("[enhance] PDF rasterisation failed:", err);
        return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: ["PDF rasterisation failed — raw PDF used, cropping unavailable"] };
      }
    }
    const meta  = await sharpFn!(inputBuffer).metadata();
    const { width = 1000, height = 1000 } = meta;
    notes.push(`Input: ${width}×${height}px ${ext.toUpperCase()}`);

    const stats = await sharpFn!(inputBuffer).stats();
    const isGrey = isEffectivelyGreyscale(stats);

    let pipeline = sharpFn!(inputBuffer);
    if (isGrey) { pipeline = pipeline.greyscale(); notes.push("Converted to greyscale"); }
    pipeline = pipeline.normalise();
    notes.push("Auto-levels applied");
    pipeline = pipeline.linear(1.15, -20);
    notes.push("Background whitening applied");
    pipeline = pipeline.sharpen({ sigma: 1.2, m1: 0.5, m2: 3 });
    notes.push("Wall sharpening applied");
    pipeline = pipeline.gamma(1.8);
    notes.push("Gamma correction applied");

    if (width < 2480) {
      pipeline = pipeline.resize(2480, null, { withoutEnlargement: false });
      notes.push("Upscaled to 2480px");
    }

    const outputBuffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
    const filename = `plan-${projectId}-enhanced.png`;
    const { url: enhancedUrl, diskPath: enhancedDiskPath } = await saveUploadedFile(outputBuffer, filename);
    notes.push(`Output: ${filename}`);
    return { originalUrl, enhancedUrl, enhancedDiskPath, processingNotes: notes };

  } catch (err) {
    console.error("[enhance] Failed:", err);
    return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: [`Enhancement failed: ${String(err)}`] };
  }
}

function isEffectivelyGreyscale(stats: import("sharp").Stats): boolean {
  if (!stats.channels || stats.channels.length < 3) return true;
  const [r, g, b] = stats.channels;
  return Math.max(Math.abs(r.mean - g.mean), Math.abs(g.mean - b.mean), Math.abs(r.mean - b.mean)) < 12;
}
