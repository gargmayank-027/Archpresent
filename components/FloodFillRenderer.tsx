/**
 * components/FloodFillRenderer.tsx
 *
 * Renders a color-coded floor plan by flood-filling rooms from their
 * center points. Uses the plan's own wall lines as natural fill boundaries,
 * giving pixel-perfect room shapes (not rectangles).
 *
 * How it works:
 *  1. Draws the plan image on a hidden canvas
 *  2. For each room with a bounding box, calculates the center point
 *  3. Flood-fills from that center — stops at dark pixels (walls)
 *  4. Overlays clean label pills at room centers
 *  5. The result can be exported as PNG and uploaded to the server
 *
 * Runs entirely in the browser — no server-side image processing needed.
 */

"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface RoomData {
  name: string;
  sizeEstimateSqm?: number;
  orientation?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

interface PlotData {
  facing?: string;
}

interface Props {
  planImageUrl: string;
  rooms: RoomData[];
  plotInfo?: PlotData;
  onRendered?: (pngBlob: Blob) => void;  // called when rendering is complete
  height?: number;
}

// ── Room type → color ────────────────────────────────────────────────────

const ROOM_COLORS: Record<string, { r: number; g: number; b: number; label: string }> = {
  bedroom:  { r: 191, g: 219, b: 254, label: "Bedrooms" },
  living:   { r: 187, g: 247, b: 208, label: "Living" },
  kitchen:  { r: 253, g: 230, b: 138, label: "Kitchen" },
  dining:   { r: 254, g: 202, b: 202, label: "Dining" },
  bathroom: { r: 209, g: 213, b: 219, label: "Bath" },
  dressing: { r: 221, g: 214, b: 254, label: "Dressing" },
  pooja:    { r: 254, g: 215, b: 170, label: "Pooja" },
  outdoor:  { r: 153, g: 246, b: 228, label: "Outdoor" },
  lobby:    { r: 254, g: 240, b: 138, label: "Lobby" },
  study:    { r: 186, g: 230, b: 253, label: "Study" },
  utility:  { r: 229, g: 231, b: 235, label: "Utility" },
  default:  { r: 243, g: 244, b: 246, label: "Other" },
};

function getRoomColor(name: string): { r: number; g: number; b: number; label: string } {
  const n = name.toLowerCase();
  if (n.includes("bed") || n.includes("master")) return ROOM_COLORS.bedroom;
  if (n.includes("living") || n.includes("drawing") || n.includes("sitting")) return ROOM_COLORS.living;
  if (n.includes("kitchen") || n.includes("kit") || n.includes("serv")) return ROOM_COLORS.kitchen;
  if (n.includes("dining") || n.includes("dinning")) return ROOM_COLORS.dining;
  if (n.includes("toilet") || n.includes("bath") || n.includes("wc")) return ROOM_COLORS.bathroom;
  if (n.includes("dress") || n.includes("wardrobe") || n.includes("w.i.w") || n.includes("closet")) return ROOM_COLORS.dressing;
  if (n.includes("pooja") || n.includes("puja") || n.includes("prayer")) return ROOM_COLORS.pooja;
  if (n.includes("balcon") || n.includes("terrace") || n.includes("porch") || n.includes("garden") || n.includes("green") || n.includes("lawn")) return ROOM_COLORS.outdoor;
  if (n.includes("lobby") || n.includes("foyer") || n.includes("entry") || n.includes("stair") || n.includes("passage") || n.includes("lift")) return ROOM_COLORS.lobby;
  if (n.includes("study") || n.includes("office")) return ROOM_COLORS.study;
  if (n.includes("utility") || n.includes("laundry") || n.includes("store") || n.includes("maid")) return ROOM_COLORS.utility;
  return ROOM_COLORS.default;
}

// ── Scanline flood fill ─────────────────────────────────────────────────
// Fast queue-based scanline fill. Stops at dark pixels (walls) and
// already-filled pixels. Max fill limit prevents runaway on open areas.

function floodFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  fillColor: { r: number; g: number; b: number },
  alpha: number,  // 0-255
  wallThreshold: number = 120,  // pixels darker than this are "walls"
  maxPixels: number = 500_000   // safety limit
) {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  let filled = 0;

  const idx = (x: number, y: number) => y * width + x;

  function isWall(x: number, y: number): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) return true;
    const i = (y * width + x) * 4;
    // Dark pixel = wall. Check brightness (R+G+B)/3
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    return brightness < wallThreshold;
  }

  function isFillable(x: number, y: number): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    if (visited[idx(x, y)]) return false;
    return !isWall(x, y);
  }

  function fillPixel(x: number, y: number) {
    const i = (y * width + x) * 4;
    // Alpha-blend the fill color over the existing pixel
    const a = alpha / 255;
    data[i]     = Math.round(data[i] * (1 - a) + fillColor.r * a);
    data[i + 1] = Math.round(data[i + 1] * (1 - a) + fillColor.g * a);
    data[i + 2] = Math.round(data[i + 2] * (1 - a) + fillColor.b * a);
    visited[idx(x, y)] = 1;
    filled++;
  }

  // Seed
  if (!isFillable(startX, startY)) return;
  stack.push(startX, startY);

  while (stack.length > 0 && filled < maxPixels) {
    const sy = stack.pop()!;
    const sx = stack.pop()!;

    if (!isFillable(sx, sy)) continue;

    // Scan left
    let lx = sx;
    while (lx > 0 && isFillable(lx - 1, sy)) lx--;

    // Scan right
    let rx = sx;
    while (rx < width - 1 && isFillable(rx + 1, sy)) rx++;

    // Fill the scanline
    let checkAbove = false;
    let checkBelow = false;

    for (let x = lx; x <= rx; x++) {
      fillPixel(x, sy);

      // Check pixel above
      if (sy > 0 && isFillable(x, sy - 1)) {
        if (!checkAbove) {
          stack.push(x, sy - 1);
          checkAbove = true;
        }
      } else {
        checkAbove = false;
      }

      // Check pixel below
      if (sy < height - 1 && isFillable(x, sy + 1)) {
        if (!checkBelow) {
          stack.push(x, sy + 1);
          checkBelow = true;
        }
      } else {
        checkBelow = false;
      }
    }
  }
}

// ── Component ───────────────────────────────────────────────────────────

export function FloodFillRenderer({ planImageUrl, rooms, plotInfo, onRendered, height = 500 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setRendering(true);
    setError(null);

    try {
      // Load the plan image
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load plan image"));
        img.src = planImageUrl;
      });

      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const legendH = 50;

      canvas.width = w;
      canvas.height = h + legendH;
      const ctx = canvas.getContext("2d")!;

      // Draw the plan
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Get pixel data for flood filling
      const imageData = ctx.getImageData(0, 0, w, h);

      // Flood fill each room from its center
      const roomsWithBox = rooms.filter((r) => r.boundingBox);
      for (const room of roomsWithBox) {
        const box = room.boundingBox!;
        const color = getRoomColor(room.name);

        // Center of the bounding box as the fill seed
        const cx = Math.round((box.x + box.width / 2) * w);
        const cy = Math.round((box.y + box.height / 2) * h);

        // Clamp to image bounds
        const seedX = Math.max(1, Math.min(w - 2, cx));
        const seedY = Math.max(1, Math.min(h - 2, cy));

        floodFill(imageData, seedX, seedY, color, 140); // alpha 140/255 ≈ 55% opacity
      }

      // Put the filled data back
      ctx.putImageData(imageData, 0, 0);

      // Draw label pills on top (after fill so they're not flood-filled)
      for (const room of roomsWithBox) {
        const box = room.boundingBox!;
        const color = getRoomColor(room.name);
        const cx = Math.round((box.x + box.width / 2) * w);
        const cy = Math.round((box.y + box.height / 2) * h);

        const displayName = room.name.length > 14
          ? room.name.replace(/Room/gi, "Rm").replace(/Dressing/gi, "Dress").trim()
          : room.name;
        const sizeText = room.sizeEstimateSqm ? `${room.sizeEstimateSqm} m²` : "";

        const fontSize = Math.max(10, Math.min(14, Math.round(Math.min(box.width * w, box.height * h) * 0.09)));

        // Measure text
        ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
        const nameMetrics = ctx.measureText(displayName);
        ctx.font = `${fontSize - 2}px Helvetica, Arial, sans-serif`;
        const sizeMetrics = sizeText ? ctx.measureText(sizeText) : { width: 0 };

        const pillW = Math.max(nameMetrics.width, sizeMetrics.width) + 16;
        const pillH = sizeText ? fontSize * 2 + 12 : fontSize + 10;
        const pillX = cx - pillW / 2;
        const pillY = cy - pillH / 2;

        // Pill background
        ctx.fillStyle = "rgba(255, 255, 255, 0.93)";
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 4);
        ctx.fill();

        // Pill border
        ctx.strokeStyle = `rgb(${color.r * 0.7}, ${color.g * 0.7}, ${color.b * 0.7})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Name text
        ctx.fillStyle = "#1a1917";
        ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayName, cx, cy - (sizeText ? 5 : 0));

        // Size text
        if (sizeText) {
          ctx.fillStyle = "#6B7280";
          ctx.font = `${fontSize - 2}px Helvetica, Arial, sans-serif`;
          ctx.fillText(sizeText, cx, cy + fontSize - 2);
        }
      }

      // ── Legend strip ──
      const legendY = h;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, legendY, w, legendH);
      ctx.strokeStyle = "#E5E7EB";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, legendY);
      ctx.lineTo(w, legendY);
      ctx.stroke();

      const usedLabels = new Set<string>();
      const legendItems: { color: { r: number; g: number; b: number }; label: string }[] = [];
      for (const room of roomsWithBox) {
        const c = getRoomColor(room.name);
        if (!usedLabels.has(c.label)) {
          usedLabels.add(c.label);
          legendItems.push({ color: c, label: c.label });
        }
      }

      const totalW = legendItems.length * 90;
      const startX = Math.max(16, (w - totalW) / 2);

      legendItems.forEach((item, i) => {
        const ix = startX + i * 90;
        // Swatch
        ctx.fillStyle = `rgb(${item.color.r}, ${item.color.g}, ${item.color.b})`;
        ctx.beginPath();
        ctx.roundRect(ix, legendY + 16, 14, 14, 3);
        ctx.fill();
        ctx.strokeStyle = `rgb(${item.color.r * 0.7}, ${item.color.g * 0.7}, ${item.color.b * 0.7})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Label
        ctx.fillStyle = "#374151";
        ctx.font = "500 10px Helvetica, Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(item.label, ix + 20, legendY + 23);
      });

      // Compass rose
      if (plotInfo?.facing) {
        const compassX = w - 50;
        const compassY = 50;
        const r = 24;
        const facingDeg: Record<string, number> = {
          north: 0, "north-east": 45, east: 90, "south-east": 135,
          south: 180, "south-west": 225, west: 270, "north-west": 315,
        };
        const rot = (facingDeg[(plotInfo.facing).toLowerCase()] ?? 0) * Math.PI / 180;

        // Background circle
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.arc(compassX, compassY, r + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#D1D5DB";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // North arrow
        ctx.save();
        ctx.translate(compassX, compassY);
        ctx.rotate(rot);
        ctx.fillStyle = "#1F2937";
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(-5, 4);
        ctx.lineTo(5, 4);
        ctx.fill();
        ctx.fillStyle = "#D1D5DB";
        ctx.beginPath();
        ctx.moveTo(0, r);
        ctx.lineTo(-5, -4);
        ctx.lineTo(5, -4);
        ctx.fill();
        ctx.restore();

        // N label
        ctx.fillStyle = "#374151";
        ctx.font = "bold 8px Helvetica, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("N", compassX, compassY - r - 6);
      }

      // Export as PNG blob
      canvas.toBlob((blob) => {
        if (blob && onRendered) onRendered(blob);
        setRendering(false);
      }, "image/png");

    } catch (err) {
      console.error("Flood fill rendering failed:", err);
      setError(err instanceof Error ? err.message : "Rendering failed");
      setRendering(false);
    }
  }, [planImageUrl, rooms, plotInfo, onRendered]);

  useEffect(() => {
    render();
  }, [render]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full rounded-sm border border-stone-200"
        style={{
          maxHeight: height,
          objectFit: "contain",
          imageRendering: "crisp-edges",
          display: error ? "none" : "block",
        }}
      />
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-sm">
          <div className="flex items-center gap-2">
            <span className="spinner w-4 h-4 text-stone-400" />
            <span className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">
              Rendering plan...
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="border border-stone-200 rounded-sm p-8 text-center bg-stone-50">
          <p className="text-sm text-stone-400">Could not render color-coded plan</p>
          <p className="text-xs text-stone-300 mt-1">{error}</p>
        </div>
      )}
    </div>
  );
}
