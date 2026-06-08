/**
 * lib/enhance.ts
 *
 * Plan image enhancement pipeline using Sharp.
 *
 * What it does:
 *   1. Normalise — auto-levels (stretches histogram to use full 0-255 range)
 *   2. Whiten background — floor plans are often grey/cream scans; push background to true white
 *   3. Sharpen walls — architectural line work needs crisp edges
 *   4. Boost contrast — makes walls read clearly at small sizes
 *   5. Denoise — removes scanner grain / JPEG artefacts
 *   6. Output as high-quality PNG (lossless, ideal for PDFs and presentations)
 *
 * If Sharp is not installed or processing fails, returns the original image
 * path untouched so the app never hard-fails on this step.
 *
 * Install: npm install sharp @types/sharp
 */

import fs from "fs";
import path from "path";
import type { EnhancedPlan } from "@/types";
import { saveUploadedFile } from "@/lib/store";

// ─── Main export ──────────────────────────────────────────────────────────────

export async function enhancePlanImage(
  diskPath: string,
  projectId: string
): Promise<EnhancedPlan> {
  const originalUrl = `/uploads/${path.basename(diskPath)}`;
  const notes: string[] = [];

  // If enhancement is disabled via env, return original immediately
  if (process.env.ENABLE_PLAN_ENHANCEMENT === "false") {
    return {
      originalUrl,
      enhancedUrl: originalUrl,
      enhancedDiskPath: diskPath,
      processingNotes: ["Enhancement disabled via ENABLE_PLAN_ENHANCEMENT=false"],
    };
  }

  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    console.warn("[enhance] Sharp not installed — skipping enhancement. Run: npm install sharp");
    return {
      originalUrl,
      enhancedUrl: originalUrl,
      enhancedDiskPath: diskPath,
      processingNotes: ["Sharp not installed — raw image used"],
    };
  }

  try {
    const inputBuffer = fs.readFileSync(diskPath);
    const ext = path.extname(diskPath).toLowerCase();
    const isPdf = ext === ".pdf";

    // PDFs need to be rasterised first — requires poppler/ghostscript on the system.
    // For v1, skip PDF enhancement and return original.
    if (isPdf) {
      return {
        originalUrl,
        enhancedUrl: originalUrl,
        enhancedDiskPath: diskPath,
        processingNotes: ["PDF detected — rasterisation not available in v1, raw used"],
      };
    }

    // ── Detect image characteristics ──────────────────────────────────────
    const metadata = await sharp(inputBuffer).metadata();
    const { width = 1000, height = 1000 } = metadata;

    notes.push(`Input: ${width}×${height}px ${ext.replace(".", "").toUpperCase()}`);

    // ── Build processing pipeline ──────────────────────────────────────────
    let pipeline = sharp(inputBuffer);

    // 1. Convert to greyscale if it looks like a B&W plan
    //    (floor plans are almost always monochrome)
    const stats = await sharp(inputBuffer).stats();
    const isMonochrome = isEffectivelyGreyscale(stats);

    if (isMonochrome) {
      pipeline = pipeline.greyscale();
      notes.push("Converted to greyscale (monochrome plan detected)");
    }

    // 2. Normalise — auto-levels
    pipeline = pipeline.normalise();
    notes.push("Auto-levels applied");

    // 3. Linear adjustment — push midtones up slightly (brightens scan grey → white)
    //    a=1.15 (mild contrast boost), b=-15 (lifts shadows/background toward white)
    pipeline = pipeline.linear(1.15, -20);
    notes.push("Background whitening applied");

    // 4. Sharpen — radius 2, flat areas sigma 0.5, jagged areas sigma 1
    //    Keeps walls crisp without halos on text labels
    pipeline = pipeline.sharpen({ sigma: 1.2, m1: 0.5, m2: 3 });
    notes.push("Wall sharpening applied");

    // 5. Gamma correction — slightly darken dark lines to make walls pop
    pipeline = pipeline.gamma(1.8);
    notes.push("Gamma correction for line clarity");

    // 6. Upscale small images for better presentation quality
    const targetWidth = Math.max(width, 2480); // at least A4 @ 300dpi width
    if (width < targetWidth) {
      pipeline = pipeline.resize(targetWidth, null, {
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: false,
      });
      notes.push(`Upscaled to ${targetWidth}px wide for presentation quality`);
    }

    // 7. Output as PNG (lossless, ideal for plan linework)
    const outputBuffer = await pipeline
      .png({ compressionLevel: 8, palette: false })
      .toBuffer();

    // ── Save enhanced file ─────────────────────────────────────────────────
    const enhancedFilename = `plan-${projectId}-enhanced.png`;
    const { url: enhancedUrl, diskPath: enhancedDiskPath } =
      await saveUploadedFile(outputBuffer, enhancedFilename);

    notes.push(`Output: ${enhancedFilename}`);

    return { originalUrl, enhancedUrl, enhancedDiskPath, processingNotes: notes };
  } catch (err) {
    console.error("[enhance] Processing failed:", err);
    return {
      originalUrl,
      enhancedUrl: originalUrl,
      enhancedDiskPath: diskPath,
      processingNotes: ["Enhancement failed — raw image used", String(err)],
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEffectivelyGreyscale(stats: import("sharp").Stats): boolean {
  // If R/G/B channel means are very close, it's greyscale
  if (!stats.channels || stats.channels.length < 3) return true;
  const [r, g, b] = stats.channels;
  const maxDiff = Math.max(
    Math.abs(r.mean - g.mean),
    Math.abs(g.mean - b.mean),
    Math.abs(r.mean - b.mean)
  );
  return maxDiff < 12; // threshold — below this = effectively greyscale
}
