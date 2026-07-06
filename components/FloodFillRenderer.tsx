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
  bedroom:  { r: 147, g: 197, b: 253, label: "Bedrooms" },    // stronger blue
  living:   { r: 134, g: 239, b: 172, label: "Living" },      // vivid green
  kitchen:  { r: 253, g: 211, b: 77,  label: "Kitchen" },     // strong amber
  dining:   { r: 252, g: 165, b: 165, label: "Dining" },      // clear coral
  bathroom: { r: 180, g: 186, b: 197, label: "Bath" },        // cool grey
  dressing: { r: 196, g: 181, b: 253, label: "Dressing" },    // strong purple
  pooja:    { r: 251, g: 176, b: 100, label: "Pooja" },       // deep saffron
  outdoor:  { r: 94,  g: 234, b: 212, label: "Outdoor" },     // vivid teal
  lobby:    { r: 253, g: 224, b: 102, label: "Lobby" },       // warm yellow
  study:    { r: 125, g: 211, b: 252, label: "Study" },       // sky blue
  utility:  { r: 209, g: 213, b: 219, label: "Utility" },     // muted
  default:  { r: 229, g: 231, b: 235, label: "Other" },
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
// Stops at thick dark lines (walls) but passes through thin lines
// (furniture, dimensions, annotations). Uses multiple seed points per
// room to handle cases where the center lands on an obstacle.

function floodFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  fillColor: { r: number; g: number; b: number },
  alpha: number,
  wallThreshold: number = 60,   // only very dark pixels are walls (lowered from 120)
  maxPixels: number = 800_000
) {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  let filled = 0;

  function isWall(x: number, y: number): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) return true;
    const i = (y * width + x) * 4;
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    // Only consider pixels as walls if they're very dark AND the surrounding
    // area is also dark (thick lines, not thin annotation lines)
    if (brightness >= wallThreshold) return false;
    // Check if this is a thick line (wall) by sampling neighbors
    // Thin lines (1-2px) won't have dark neighbors in all directions
    let darkNeighbors = 0;
    for (const [dx, dy] of [[0, -2], [0, 2], [-2, 0], [2, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const ni = (ny * width + nx) * 4;
        if ((data[ni] + data[ni + 1] + data[ni + 2]) / 3 < wallThreshold) {
          darkNeighbors++;
        }
      }
    }
    // Only treat as wall if at least 2 neighbors are also dark (thick line)
    return darkNeighbors >= 2;
  }

  function isFillable(x: number, y: number): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = y * width + x;
    if (visited[idx]) return false;
    return !isWall(x, y);
  }

  function fillPixel(x: number, y: number) {
    const i = (y * width + x) * 4;
    const a = alpha / 255;
    data[i]     = Math.round(data[i] * (1 - a) + fillColor.r * a);
    data[i + 1] = Math.round(data[i + 1] * (1 - a) + fillColor.g * a);
    data[i + 2] = Math.round(data[i + 2] * (1 - a) + fillColor.b * a);
    visited[y * width + x] = 1;
    filled++;
  }

  if (!isFillable(startX, startY)) return filled;
  stack.push(startX, startY);

  while (stack.length > 0 && filled < maxPixels) {
    const sy = stack.pop()!;
    const sx = stack.pop()!;
    if (!isFillable(sx, sy)) continue;

    let lx = sx;
    while (lx > 0 && isFillable(lx - 1, sy)) lx--;
    let rx = sx;
    while (rx < width - 1 && isFillable(rx + 1, sy)) rx++;

    let checkAbove = false;
    let checkBelow = false;

    for (let x = lx; x <= rx; x++) {
      fillPixel(x, sy);

      if (sy > 0 && isFillable(x, sy - 1)) {
        if (!checkAbove) { stack.push(x, sy - 1); checkAbove = true; }
      } else { checkAbove = false; }

      if (sy < height - 1 && isFillable(x, sy + 1)) {
        if (!checkBelow) { stack.push(x, sy + 1); checkBelow = true; }
      } else { checkBelow = false; }
    }
  }

  return filled;
}

/**
 * Try flood-filling a room by scanning a grid of seed points within
 * the bounding box and picking the one in the clearest area.
 *
 * The previous approach tried 9 fixed positions — this scans a 5x5 grid
 * (25 points) and for each, checks a small neighborhood to find one
 * that's in open space (not on furniture, text, or hatching).
 */
function floodFillRoom(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
  imgW: number,
  imgH: number,
  color: { r: number; g: number; b: number },
  alpha: number
): number {
  const { data, width } = imageData;

  // Score a point by checking how "clear" the area around it is.
  // Higher score = more white/light pixels nearby = better seed point.
  function clearnessScore(px: number, py: number, radius: number = 4): number {
    let lightPixels = 0;
    let total = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || x >= imgW || y < 0 || y >= imgH) continue;
        total++;
        const i = (y * width + x) * 4;
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (brightness > 200) lightPixels++;  // clearly white/light
      }
    }
    return total > 0 ? lightPixels / total : 0;
  }

  // Scan a grid of points within the bounding box
  const gridSize = 6;
  type Candidate = { x: number; y: number; score: number };
  const candidates: Candidate[] = [];

  for (let gy = 1; gy < gridSize; gy++) {
    for (let gx = 1; gx < gridSize; gx++) {
      const fx = gx / gridSize;
      const fy = gy / gridSize;
      const px = Math.round((box.x + box.width * fx) * imgW);
      const py = Math.round((box.y + box.height * fy) * imgH);
      const seedX = Math.max(2, Math.min(imgW - 3, px));
      const seedY = Math.max(2, Math.min(imgH - 3, py));
      const score = clearnessScore(seedX, seedY, 5);
      if (score > 0.3) {  // at least 30% of neighborhood is light
        candidates.push({ x: seedX, y: seedY, score });
      }
    }
  }

  // Sort by clearness — try the clearest spots first
  candidates.sort((a, b) => b.score - a.score);

  for (const seed of candidates) {
    const filled = floodFill(imageData, seed.x, seed.y, color, alpha);
    if (filled > 50) return filled;
  }

  // Last resort: try the exact center anyway
  const cx = Math.round((box.x + box.width / 2) * imgW);
  const cy = Math.round((box.y + box.height / 2) * imgH);
  return floodFill(imageData, cx, cy, color, alpha);
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

      // Flood fill each room from its bounding box center (with fallback seed points)
      const roomsWithBox = rooms.filter((r) => r.boundingBox);
      for (const room of roomsWithBox) {
        const box = room.boundingBox!;
        const color = getRoomColor(room.name);
        const filled = floodFillRoom(imageData, box, w, h, color, 130);
        console.log(`[FloodFill] ${room.name}: ${filled} pixels filled`);
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
