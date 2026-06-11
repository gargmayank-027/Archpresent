/**
 * lib/planCrop.ts
 *
 * Crops room snippets from the floor plan.
 * Works with both local disk paths and remote Vercel Blob URLs.
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
  // Skip PDFs
  if (planImagePath.toLowerCase().endsWith(".pdf")) return null;

  try {
    const sharp = (await import("sharp")).default;

    // Load image from disk or remote URL
    let inputBuffer: Buffer;
    if (planImagePath.startsWith("http")) {
      const res = await fetch(planImagePath);
      if (!res.ok) return null;
      inputBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      const fs = require("fs") as typeof import("fs");
      if (!fs.existsSync(planImagePath)) return null;
      inputBuffer = fs.readFileSync(planImagePath);
    }

    const meta   = await (sharp as unknown as (buf: Buffer) => ReturnType<typeof sharp>)(inputBuffer).metadata();
    const pw     = meta.width  ?? 1000;
    const ph     = meta.height ?? 1000;

    const zone = ROOM_ZONES[roomName];
    const cellW = 1 / GRID_COLS;
    const cellH = 1 / GRID_ROWS;

    const rawLeft = (zone?.col ?? 0) * cellW;
    const rawTop  = (zone?.row ?? 0) * cellH;
    const rawW    = (zone?.w  ?? 1) * cellW;
    const rawH    = (zone?.h  ?? 1) * cellH;

    const left  = Math.max(0, rawLeft - PAD);
    const top   = Math.max(0, rawTop  - PAD);
    const right = Math.min(1, rawLeft + rawW + PAD);
    const bot   = Math.min(1, rawTop  + rawH + PAD);

    const cropLeft   = Math.round(left     * pw);
    const cropTop    = Math.round(top      * ph);
    const cropWidth  = Math.round((right - left) * pw);
    const cropHeight = Math.round((bot   - top)  * ph);

    if (cropWidth < 50 || cropHeight < 50) return null;

    const buffer = await (sharp as unknown as (buf: Buffer) => ReturnType<typeof sharp>)(inputBuffer)
      .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
      .normalise()
      .linear(1.1, -5)
      .sharpen({ sigma: 0.8 })
      .resize(420, null, { withoutEnlargement: false })
      .png({ compressionLevel: 8 })
      .toBuffer();

    const slug  = roomName.toLowerCase().replace(/\s+/g, "-");
    const fname = `snippet-${projectId}-${slug}.png`;
    const { url } = await saveUploadedFile(buffer, fname);
    return url;

  } catch (err) {
    console.warn(`[planCrop] Failed for ${roomName}:`, err);
    return null;
  }
}
