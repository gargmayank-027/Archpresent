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
  } catch {
    return null; // sharp not available — skip cropping
  }

  try {
    let inputBuffer: Buffer;
    if (planImagePath.startsWith("http")) {
      const res = await fetch(planImagePath);
      if (!res.ok) return null;
      inputBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      const { readFileSync, existsSync } = await import("fs");
      if (!existsSync(planImagePath)) return null;
      inputBuffer = readFileSync(planImagePath);
    }

    const meta = await sharpFn!(inputBuffer).metadata();
    const pw   = meta.width  ?? 1000;
    const ph   = meta.height ?? 1000;

    // Validate bounding box — LLMs sometimes return values outside 0-1 range
    // or nonsensically small boxes. Reject obviously wrong coordinates.
    if (
      boundingBox.x < 0 || boundingBox.x > 1 ||
      boundingBox.y < 0 || boundingBox.y > 1 ||
      boundingBox.width  <= 0.01 || boundingBox.width  > 1 ||
      boundingBox.height <= 0.01 || boundingBox.height > 1
    ) {
      console.warn(`[planCrop] Invalid boundingBox for ${roomName}:`, boundingBox);
      return null;
    }

    const left = Math.max(0, boundingBox.x - PAD);
    const top  = Math.max(0, boundingBox.y - PAD);
    const right = Math.min(1, boundingBox.x + boundingBox.width  + PAD);
    const bot   = Math.min(1, boundingBox.y + boundingBox.height + PAD);

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
