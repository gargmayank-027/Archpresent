/**
 * lib/enhance.ts
 *
 * Plan image enhancement using Sharp.
 * On Vercel: Sharp may not have native binaries available — the function
 * gracefully falls back to returning the original image.
 *
 * On Vercel, planImagePath will be a Blob URL (https://...) not a disk path.
 * We download it first, process in memory, then re-upload via saveUploadedFile.
 */

import type { EnhancedPlan } from "@/types";
import { saveUploadedFile } from "@/lib/store";

export async function enhancePlanImage(
  planImagePath: string,
  projectId: string
): Promise<EnhancedPlan> {
  // planImagePath on Vercel is actually the blob URL stored in planImageUrl
  // We use planImageUrl (the public URL) for the original
  const originalUrl = planImagePath.startsWith("http")
    ? planImagePath
    : `/uploads/${planImagePath.split("/").pop()}`;

  const notes: string[] = [];

  if (process.env.ENABLE_PLAN_ENHANCEMENT === "false") {
    return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: ["Enhancement disabled"] };
  }

  // Try to load Sharp
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    console.warn("[enhance] Sharp unavailable — skipping enhancement");
    return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: ["Sharp not available — raw image used"] };
  }

  try {
    // Load image bytes — from disk or remote URL
    let inputBuffer: Buffer;
    if (planImagePath.startsWith("http")) {
      const res = await fetch(planImagePath);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      inputBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      // Local disk path
      const fs = require("fs") as typeof import("fs");
      if (!fs.existsSync(planImagePath)) {
        return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: ["Image file not found"] };
      }
      inputBuffer = fs.readFileSync(planImagePath);
    }

    const ext = planImagePath.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") {
      return { originalUrl, enhancedUrl: originalUrl, enhancedDiskPath: planImagePath, processingNotes: ["PDF — enhancement skipped"] };
    }

    const metadata = await sharp(inputBuffer).metadata();
    const { width = 1000 } = metadata;

    notes.push(`Input: ${metadata.width}×${metadata.height}px ${ext.toUpperCase()}`);

    const stats = await sharp(inputBuffer).stats();
    const isMonochrome = isEffectivelyGreyscale(stats);

    let pipeline = sharp(inputBuffer);
    if (isMonochrome) { pipeline = pipeline.greyscale(); notes.push("Converted to greyscale"); }
    pipeline = pipeline.normalise();          notes.push("Auto-levels applied");
    pipeline = pipeline.linear(1.15, -20);   notes.push("Background whitening applied");
    pipeline = pipeline.sharpen({ sigma: 1.2, m1: 0.5, m2: 3 }); notes.push("Wall sharpening applied");
    pipeline = pipeline.gamma(1.8);           notes.push("Gamma correction for line clarity");

    const targetWidth = Math.max(width, 2480);
    if (width < targetWidth) {
      pipeline = pipeline.resize(targetWidth, null, { kernel: (sharp as unknown as { kernel: { lanczos3: string } }).kernel.lanczos3, withoutEnlargement: false });
      notes.push(`Upscaled to ${targetWidth}px wide`);
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
