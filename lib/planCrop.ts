/**
 * lib/planCrop.ts — plan snippet cropping
 *
 * IMPORTANT: We do NOT guess room locations using a fixed grid anymore.
 * A hardcoded "Bedroom 2 is probably top-right" heuristic produced wrong
 * crops most of the time, which actively misleads the architect.
 *
 * Behaviour now:
 *   - If room.boundingBox is present (real coordinates from a future
 *     vision-based room-detection pass), crop precisely using it.
 *   - Otherwise, return null. The caller falls back to showing the full
 *     uncropped plan image, which is honest even if less specific.
 */

import { saveUploadedFile } from "@/lib/store";
import type { RoomBoundingBox } from "@/types";

const PAD = 0.04; // 4% padding around a known bounding box for context

export async function cropRoomFromPlan(
  planImagePath: string,
  roomName: string,
  projectId: string,
  boundingBox?: RoomBoundingBox
): Promise<string | null> {
  // No real coordinates known — don't guess. Caller shows full plan instead.
  if (!boundingBox) return null;

  if (planImagePath.toLowerCase().endsWith(".pdf")) return null;

  let sharpFn: ((input: Buffer) => import("sharp").Sharp) | null = null;
  try {
    const mod = await import("sharp");
    sharpFn = (mod.default ?? mod) as typeof sharpFn;
    console.log(`[planCrop] Sharp available for ${roomName}`);
  } catch {
    console.warn(`[planCrop] Sharp not available — cannot crop ${roomName}`);
    return null;
  }

  try {
    let inputBuffer: Buffer;
    if (planImagePath.startsWith("http")) {
      console.log(`[planCrop] Fetching plan image for ${roomName}: ${planImagePath.slice(0, 80)}…`);
      const res = await fetch(planImagePath);
      if (!res.ok) {
        console.warn(`[planCrop] Image fetch failed for ${roomName}: HTTP ${res.status}`);
        return null;
      }
      inputBuffer = Buffer.from(await res.arrayBuffer());
      console.log(`[planCrop] Image downloaded: ${(inputBuffer.length/1024).toFixed(0)}KB`);
    } else {
      const { readFileSync, existsSync } = await import("fs");
      if (!existsSync(planImagePath)) return null;
      inputBuffer = readFileSync(planImagePath);
    }

    const meta = await sharpFn!(inputBuffer).metadata();
    const pw   = meta.width  ?? 1000;
    const ph   = meta.height ?? 1000;

    // Clamp and validate bounding box — LLMs sometimes return values slightly
    // outside 0-1 range (e.g. 1.02) or forget to include it.
    // Be lenient: clamp to valid range rather than rejecting.
    const bb = {
      x:      Math.max(0, Math.min(0.95, boundingBox.x)),
      y:      Math.max(0, Math.min(0.95, boundingBox.y)),
      width:  Math.max(0.05, Math.min(1, boundingBox.width)),
      height: Math.max(0.05, Math.min(1, boundingBox.height)),
    };

    // Only reject if clearly nonsensical (e.g. all zeros)
    if (bb.x === 0 && bb.y === 0 && bb.width >= 0.99 && bb.height >= 0.99) {
      console.warn(`[planCrop] boundingBox covers entire image for ${roomName} — likely a fallback, skipping`);
      return null;
    }

    console.log(`[planCrop] Cropping ${roomName} at x:${bb.x.toFixed(2)} y:${bb.y.toFixed(2)} w:${bb.width.toFixed(2)} h:${bb.height.toFixed(2)}`);

    // Use clamped bb values (never re-declare boundingBox — causes minifier TDZ error)
    const left  = Math.max(0, bb.x - PAD);
    const top   = Math.max(0, bb.y - PAD);
    const right = Math.min(1, bb.x + bb.width  + PAD);
    const bot   = Math.min(1, bb.y + bb.height + PAD);

    const cLeft   = Math.round(left  * pw);
    const cTop    = Math.round(top   * ph);
    const cWidth  = Math.round((right - left) * pw);
    const cHeight = Math.round((bot   - top ) * ph);

    if (cWidth < 50 || cHeight < 50) return null;

    const buffer = await sharpFn!(inputBuffer)
      .extract({ left: cLeft, top: cTop, width: cWidth, height: cHeight })
      .normalise().linear(1.1, -5).sharpen({ sigma: 0.8 })
      .resize(420, null, { withoutEnlargement: false })
      .png({ compressionLevel: 8 })
      .toBuffer();

    const slug  = roomName.toLowerCase().replace(/\s+/g, "-");
    const { url } = await saveUploadedFile(buffer, `snippet-${projectId}-${slug}.png`);
    return url;
  } catch (err) {
    console.warn(`[planCrop] Failed for ${roomName}:`, err);
    return null;
  }
}
