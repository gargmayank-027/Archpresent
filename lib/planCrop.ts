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

// ── Crop sizing ─────────────────────────────────────────────────────────
// v1 used a flat 4% padding regardless of room size — disproportionate for
// small rooms (barely any context) and for large rooms (too much), and it
// never locked an aspect ratio, so walkthrough cards came out in whatever
// shape each room happened to be. v2 makes the margin proportional to the
// room's own size, locks every card to the same aspect ratio, and adds a
// visual highlight so the target room reads clearly even with neighboring
// space now visible around it.

const MARGIN_RATIO = 0.25;              // context margin, as a fraction of the room's longer side
const SMALL_ROOM_MARGIN_RATIO = 0.4;    // more margin for small rooms so they don't feel like a sliver
const SMALL_ROOM_THRESHOLD_RATIO = 0.08; // room counts as "small" below this fraction of the plan's shorter side
const TARGET_W = 480;
const TARGET_H = 360;                   // 4:3 — consistent card shape in the Walkthrough grid
const TARGET_ASPECT = TARGET_W / TARGET_H;
const MAX_UPSCALE = 2.2;                // beyond this, fall back to no snippet rather than a blurry crop
const DIM_OPACITY = 0.55;               // how much the non-target context is washed out
const HIGHLIGHT_STROKE = "#57534E";     // muted stone tone — Design Principle 3.3 (restraint, not decoration)

export async function cropRoomFromPlan(
  planImagePath: string,
  roomName: string,
  projectId: string,
  boundingBox?: RoomBoundingBox
): Promise<string | null> {
  // No real coordinates known — don't guess. Caller shows full plan instead.
  if (!boundingBox) return null;

  let sharpFn: ((input: Buffer, opts?: object) => import("sharp").Sharp) | null = null;
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

    // PDFs are rasterised to PNG client-side before analysis, so
    // planImagePath should never be a .pdf here. If it somehow is,
    // we can't rasterise server-side — just skip the crop.
    if (planImagePath.toLowerCase().endsWith(".pdf")) {
      console.warn(`[planCrop] Skipping crop for ${roomName} — raw PDF path reached server`);
      return null;
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

    // Use clamped bb values (never re-declare boundingBox — causes minifier TDZ error).
    // Work in pixel space from here so margin/aspect math isn't distorted by
    // non-square plan images.
    const rawLeftPx   = bb.x * pw;
    const rawTopPx    = bb.y * ph;
    const rawWidthPx  = bb.width  * pw;
    const rawHeightPx = bb.height * ph;

    // 1. Proportional context margin — scales with the room, not the plan.
    const shorterPlanDim = Math.min(pw, ph);
    const isSmallRoom = Math.min(rawWidthPx, rawHeightPx) < shorterPlanDim * SMALL_ROOM_THRESHOLD_RATIO;
    const marginRatio = isSmallRoom ? SMALL_ROOM_MARGIN_RATIO : MARGIN_RATIO;
    const marginPx = Math.max(rawWidthPx, rawHeightPx) * marginRatio;

    let left   = rawLeftPx - marginPx;
    let top    = rawTopPx - marginPx;
    let right  = rawLeftPx + rawWidthPx + marginPx;
    let bottom = rawTopPx + rawHeightPx + marginPx;

    // 2. Lock the crop window to the target aspect ratio by extending the
    //    shorter axis symmetrically — never by stretching pixels.
    const boxW = right - left;
    const boxH = bottom - top;
    const currentAspect = boxW / boxH;
    if (currentAspect < TARGET_ASPECT) {
      const targetW = boxH * TARGET_ASPECT;
      const extra = (targetW - boxW) / 2;
      left -= extra; right += extra;
    } else if (currentAspect > TARGET_ASPECT) {
      const targetH = boxW / TARGET_ASPECT;
      const extra = (targetH - boxH) / 2;
      top -= extra; bottom += extra;
    }

    // 3. Clamp to the plan bounds by shifting the window first (preserves
    //    the locked aspect ratio); only shrinks if the plan itself is
    //    smaller than the target window, an edge case worth accepting.
    if (left < 0)   { right  -= left;   left = 0; }
    if (top < 0)    { bottom -= top;    top = 0; }
    if (right > pw) { const shift = right - pw; left -= shift; right = pw; }
    if (bottom > ph){ const shift = bottom - ph; top -= shift; bottom = ph; }
    left = Math.max(0, left); top = Math.max(0, top);
    right = Math.min(pw, right); bottom = Math.min(ph, bottom);

    const cLeft   = Math.round(left);
    const cTop    = Math.round(top);
    const cWidth  = Math.round(right - left);
    const cHeight = Math.round(bottom - top);

    // 4. Minimum-size floor — if we'd have to upscale the crop too far to
    //    fill a card, it'll look blurry/pixelated. Bail out to null so the
    //    caller falls back to no snippet (icon + text only) rather than a
    //    degraded image.
    if (cWidth < 40 || cHeight < 40) return null;
    const upscale = Math.max(TARGET_W / cWidth, TARGET_H / cHeight);
    if (upscale > MAX_UPSCALE) {
      console.warn(`[planCrop] ${roomName} crop too small (${cWidth}x${cHeight}, would need ${upscale.toFixed(1)}x upscale) — skipping snippet`);
      return null;
    }

    // 5. Highlight overlay: the crop now shows real context around the
    //    room (walls, neighbors), so wash out everything except the
    //    target room's rect and outline it, so it still reads as "this
    //    one" at a glance — coordinates are crop-local.
    const hlX = Math.max(0, rawLeftPx - cLeft);
    const hlY = Math.max(0, rawTopPx - cTop);
    const hlW = Math.min(cWidth - hlX, rawWidthPx);
    const hlH = Math.min(cHeight - hlY, rawHeightPx);
    const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cWidth}" height="${cHeight}">
      <defs>
        <mask id="dim">
          <rect x="0" y="0" width="${cWidth}" height="${cHeight}" fill="white" />
          <rect x="${hlX}" y="${hlY}" width="${hlW}" height="${hlH}" rx="3" fill="black" />
        </mask>
      </defs>
      <rect x="0" y="0" width="${cWidth}" height="${cHeight}" fill="white" fill-opacity="${DIM_OPACITY}" mask="url(#dim)" />
      <rect x="${hlX}" y="${hlY}" width="${hlW}" height="${hlH}" rx="3" fill="none" stroke="${HIGHLIGHT_STROKE}" stroke-width="2.5" />
    </svg>`;

    const buffer = await sharpFn!(inputBuffer)
      .extract({ left: cLeft, top: cTop, width: cWidth, height: cHeight })
      .normalise().linear(1.1, -5).sharpen({ sigma: 0.8 })
      .composite([{ input: Buffer.from(overlaySvg), left: 0, top: 0 }])
      .resize(TARGET_W, TARGET_H, { fit: "fill" }) // aspect already locked above — fill is safe, guarantees uniform card size
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
