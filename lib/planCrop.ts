/**
 * lib/planCrop.ts — plan snippet cropping, safe dynamic sharp import
 */

import { saveUploadedFile } from "@/lib/store";

const ROOM_ZONES: Record<string, { col: number; row: number; w: number; h: number }> = {
  "Living Room":     { col: 0, row: 0, w: 2, h: 1 },
  "Dining":          { col: 0, row: 1, w: 1, h: 1 },
  "Kitchen":         { col: 0, row: 2, w: 1, h: 1 },
  "Master Bedroom":  { col: 2, row: 0, w: 1, h: 1 },
  "Bedroom 2":       { col: 2, row: 1, w: 1, h: 1 },
  "Bedroom 3":       { col: 2, row: 2, w: 1, h: 1 },
  "Bedroom 4":       { col: 1, row: 2, w: 1, h: 1 },
  "Bathroom":        { col: 1, row: 1, w: 1, h: 1 },
  "Master Bathroom": { col: 2, row: 0, w: 1, h: 1 },
  "Common Bathroom": { col: 1, row: 1, w: 1, h: 1 },
  "Balcony":         { col: 0, row: 0, w: 1, h: 1 },
  "Pooja Room":      { col: 1, row: 0, w: 1, h: 1 },
};

const GRID_COLS = 3;
const GRID_ROWS = 3;
const PAD       = 0.08;

export async function cropRoomFromPlan(
  planImagePath: string,
  roomName: string,
  projectId: string
): Promise<string | null> {
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

    const meta   = await sharpFn!(inputBuffer).metadata();
    const pw     = meta.width  ?? 1000;
    const ph     = meta.height ?? 1000;
    const zone   = ROOM_ZONES[roomName];
    const cellW  = 1 / GRID_COLS;
    const cellH  = 1 / GRID_ROWS;
    const rawL   = (zone?.col ?? 0) * cellW;
    const rawT   = (zone?.row ?? 0) * cellH;
    const rawW   = (zone?.w   ?? 1) * cellW;
    const rawH   = (zone?.h   ?? 1) * cellH;

    const left   = Math.max(0, rawL - PAD);
    const top    = Math.max(0, rawT - PAD);
    const right  = Math.min(1, rawL + rawW + PAD);
    const bot    = Math.min(1, rawT + rawH + PAD);

    const cLeft  = Math.round(left       * pw);
    const cTop   = Math.round(top        * ph);
    const cWidth = Math.round((right - left) * pw);
    const cHeight= Math.round((bot   - top ) * ph);

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
