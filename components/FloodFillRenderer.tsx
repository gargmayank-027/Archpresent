"use client";

/**
 * components/FloodFillRenderer.tsx
 *
 * Pixel-perfect room coloring using Canvas 2D flood fill.
 * 
 * v3 improvements:
 *  - Flood fill CLAMPED to bounding box (no leaking through doorways)
 *  - Colors derived from firm's accent palette (not hardcoded)
 *  - Same room types always get the same color
 *  - Small-room handling for bathrooms/dressing (smaller seed grid, lower thresholds)
 */

import { useRef, useState, useEffect, useCallback } from "react";

interface RoomData {
  name: string;
  sizeEstimateSqm?: number;
  orientation?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

interface PlotData { facing?: string; }

interface Props {
  planImageUrl: string;
  rooms: RoomData[];
  plotInfo?: PlotData;
  accentColor?: string;   // firm's chosen accent: graphite, navy, forest, terracotta, slate, plum
  onRendered?: (pngBlob: Blob) => void;
  height?: number;
}

// ── Accent-based palettes ──────────────────────────────────────────────
// Each palette is derived from the firm's accent color, with harmonious
// tints for different room types. Same room type = same color always.

type RoomType = "bedroom" | "living" | "kitchen" | "dining" | "bathroom" | "dressing" | "pooja" | "outdoor" | "lobby" | "study" | "utility" | "default";

const PALETTES: Record<string, Record<RoomType, { r: number; g: number; b: number }>> = {
  graphite: {
    bedroom:  { r: 178, g: 190, b: 210 },  // steel blue
    living:   { r: 170, g: 210, b: 180 },  // sage
    kitchen:  { r: 230, g: 210, b: 150 },  // warm sand
    dining:   { r: 220, g: 190, b: 170 },  // blush
    bathroom: { r: 195, g: 200, b: 210 },  // cool grey
    dressing: { r: 200, g: 190, b: 215 },  // lavender grey
    pooja:    { r: 235, g: 200, b: 155 },  // warm gold
    outdoor:  { r: 175, g: 215, b: 200 },  // mint
    lobby:    { r: 215, g: 210, b: 195 },  // warm cream
    study:    { r: 185, g: 200, b: 220 },  // light slate
    utility:  { r: 210, g: 210, b: 210 },  // neutral
    default:  { r: 220, g: 220, b: 220 },
  },
  navy: {
    bedroom:  { r: 170, g: 190, b: 225 },  // soft navy blue
    living:   { r: 165, g: 210, b: 195 },  // sea green
    kitchen:  { r: 225, g: 210, b: 160 },  // butter
    dining:   { r: 215, g: 185, b: 175 },  // warm rose
    bathroom: { r: 185, g: 195, b: 215 },  // blue grey
    dressing: { r: 190, g: 185, b: 220 },  // periwinkle
    pooja:    { r: 230, g: 200, b: 155 },  // amber
    outdoor:  { r: 170, g: 215, b: 210 },  // aqua
    lobby:    { r: 205, g: 210, b: 225 },  // ice blue
    study:    { r: 175, g: 195, b: 230 },  // cornflower
    utility:  { r: 200, g: 205, b: 215 },
    default:  { r: 215, g: 220, b: 225 },
  },
  forest: {
    bedroom:  { r: 175, g: 210, b: 195 },  // sage green
    living:   { r: 160, g: 215, b: 175 },  // fresh green
    kitchen:  { r: 225, g: 215, b: 160 },  // lemon
    dining:   { r: 220, g: 195, b: 170 },  // peach
    bathroom: { r: 190, g: 205, b: 200 },  // grey green
    dressing: { r: 195, g: 195, b: 210 },  // grey lavender
    pooja:    { r: 230, g: 200, b: 150 },  // gold
    outdoor:  { r: 155, g: 220, b: 185 },  // emerald tint
    lobby:    { r: 210, g: 215, b: 195 },  // pale sage
    study:    { r: 180, g: 210, b: 200 },  // teal tint
    utility:  { r: 205, g: 210, b: 205 },
    default:  { r: 215, g: 220, b: 215 },
  },
  terracotta: {
    bedroom:  { r: 215, g: 190, b: 180 },  // warm blush
    living:   { r: 195, g: 215, b: 180 },  // olive tint
    kitchen:  { r: 235, g: 205, b: 155 },  // golden sand
    dining:   { r: 230, g: 185, b: 165 },  // terracotta tint
    bathroom: { r: 205, g: 200, b: 195 },  // warm grey
    dressing: { r: 210, g: 195, b: 205 },  // mauve
    pooja:    { r: 240, g: 195, b: 140 },  // deep amber
    outdoor:  { r: 185, g: 215, b: 195 },  // sage mint
    lobby:    { r: 225, g: 215, b: 195 },  // cream
    study:    { r: 200, g: 195, b: 210 },  // dusty blue
    utility:  { r: 210, g: 205, b: 200 },
    default:  { r: 220, g: 215, b: 210 },
  },
  slate: {
    bedroom:  { r: 180, g: 195, b: 215 },  // slate blue
    living:   { r: 170, g: 210, b: 190 },  // cool green
    kitchen:  { r: 225, g: 215, b: 165 },  // warm
    dining:   { r: 215, g: 190, b: 180 },  // rose
    bathroom: { r: 190, g: 200, b: 210 },  // blue grey
    dressing: { r: 200, g: 190, b: 215 },  // violet grey
    pooja:    { r: 230, g: 200, b: 155 },  // gold
    outdoor:  { r: 170, g: 215, b: 205 },  // teal
    lobby:    { r: 210, g: 212, b: 218 },  // light slate
    study:    { r: 185, g: 200, b: 225 },  // steel
    utility:  { r: 205, g: 208, b: 215 },
    default:  { r: 215, g: 218, b: 222 },
  },
  plum: {
    bedroom:  { r: 200, g: 185, b: 215 },  // soft plum
    living:   { r: 175, g: 210, b: 190 },  // sage
    kitchen:  { r: 225, g: 210, b: 160 },  // warm
    dining:   { r: 220, g: 185, b: 185 },  // rose
    bathroom: { r: 200, g: 195, b: 210 },  // grey violet
    dressing: { r: 210, g: 190, b: 220 },  // lilac
    pooja:    { r: 235, g: 200, b: 155 },  // amber
    outdoor:  { r: 175, g: 215, b: 200 },  // mint
    lobby:    { r: 215, g: 205, b: 220 },  // pale plum
    study:    { r: 190, g: 190, b: 225 },  // periwinkle
    utility:  { r: 208, g: 205, b: 212 },
    default:  { r: 218, g: 215, b: 222 },
  },
};

function classifyRoom(name: string): RoomType {
  const n = name.toLowerCase();
  if (n.includes("bed") || n.includes("master")) return "bedroom";
  if (n.includes("living") || n.includes("drawing") || n.includes("sitting")) return "living";
  if (n.includes("kitchen") || n.includes("kit") || n.includes("serv")) return "kitchen";
  if (n.includes("dining") || n.includes("dinning")) return "dining";
  if (n.includes("toilet") || n.includes("bath") || n.includes("wc") || n.includes("c.toilet") || n.includes("common toilet")) return "bathroom";
  if (n.includes("dress") || n.includes("wardrobe") || n.includes("w.i.w") || n.includes("w.i.c") || n.includes("wic") || n.includes("closet")) return "dressing";
  if (n.includes("pooja") || n.includes("puja") || n.includes("prayer")) return "pooja";
  if (n.includes("balcon") || n.includes("terrace") || n.includes("porch") || n.includes("garden") || n.includes("green") || n.includes("lawn") || n.includes("deck") || n.includes("front open")) return "outdoor";
  if (n.includes("lobby") || n.includes("foyer") || n.includes("entry") || n.includes("stair") || n.includes("passage") || n.includes("lift") || n.includes("corridor")) return "lobby";
  if (n.includes("study") || n.includes("office")) return "study";
  if (n.includes("utility") || n.includes("laundry") || n.includes("store") || n.includes("maid")) return "utility";
  return "default";
}

// ── Clamped scanline flood fill ─────────────────────────────────────────
// Fill stays WITHIN the bounding box — prevents leaking through doorways.

function floodFill(
  imageData: ImageData,
  startX: number, startY: number,
  fillColor: { r: number; g: number; b: number },
  alpha: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  wallThreshold: number = 55,
  maxPixels: number = 900_000
): number {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  let filled = 0;

  function isWall(x: number, y: number): boolean {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return true;
    const i = (y * width + x) * 4;
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (brightness >= wallThreshold) return false;
    // Thick-line check: only walls if neighbors are also dark
    let dark = 0;
    for (const [dx, dy] of [[0, -2], [0, 2], [-2, 0], [2, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const ni = (ny * width + nx) * 4;
        if ((data[ni] + data[ni + 1] + data[ni + 2]) / 3 < wallThreshold) dark++;
      }
    }
    return dark >= 2;
  }

  function ok(x: number, y: number): boolean {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return false;
    return !visited[y * width + x] && !isWall(x, y);
  }

  function fill(x: number, y: number) {
    const i = (y * width + x) * 4;
    const a = alpha / 255;
    data[i]     = Math.round(data[i] * (1 - a) + fillColor.r * a);
    data[i + 1] = Math.round(data[i + 1] * (1 - a) + fillColor.g * a);
    data[i + 2] = Math.round(data[i + 2] * (1 - a) + fillColor.b * a);
    visited[y * width + x] = 1;
    filled++;
  }

  if (!ok(startX, startY)) return 0;
  stack.push(startX, startY);

  while (stack.length > 0 && filled < maxPixels) {
    const sy = stack.pop()!;
    const sx = stack.pop()!;
    if (!ok(sx, sy)) continue;

    let lx = sx;
    while (lx > bounds.minX && ok(lx - 1, sy)) lx--;
    let rx = sx;
    while (rx < bounds.maxX && ok(rx + 1, sy)) rx++;

    let ca = false, cb = false;
    for (let x = lx; x <= rx; x++) {
      fill(x, sy);
      if (sy > bounds.minY && ok(x, sy - 1)) { if (!ca) { stack.push(x, sy - 1); ca = true; } } else ca = false;
      if (sy < bounds.maxY && ok(x, sy + 1)) { if (!cb) { stack.push(x, sy + 1); cb = true; } } else cb = false;
    }
  }
  return filled;
}

function floodFillRoom(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
  imgW: number, imgH: number,
  color: { r: number; g: number; b: number },
  alpha: number
): number {
  const { data, width } = imageData;

  // Clamp fill to bounding box + small margin
  const margin = 5;
  const bounds = {
    minX: Math.max(0, Math.round(box.x * imgW) - margin),
    minY: Math.max(0, Math.round(box.y * imgH) - margin),
    maxX: Math.min(imgW - 1, Math.round((box.x + box.width) * imgW) + margin),
    maxY: Math.min(imgH - 1, Math.round((box.y + box.height) * imgH) + margin),
  };

  const boxPxW = bounds.maxX - bounds.minX;
  const boxPxH = bounds.maxY - bounds.minY;
  const isSmall = boxPxW < 80 || boxPxH < 80;

  function clearness(px: number, py: number, r: number): number {
    let light = 0, total = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || x >= imgW || y < 0 || y >= imgH) continue;
        total++;
        const i = (y * width + x) * 4;
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 180) light++;
      }
    }
    return total > 0 ? light / total : 0;
  }

  // Grid scan — denser for small rooms
  const grid = isSmall ? 8 : 6;
  const minClearness = isSmall ? 0.15 : 0.25;
  const checkRadius = isSmall ? 3 : 5;

  type Seed = { x: number; y: number; score: number };
  const seeds: Seed[] = [];

  for (let gy = 1; gy < grid; gy++) {
    for (let gx = 1; gx < grid; gx++) {
      const px = Math.round(bounds.minX + boxPxW * (gx / grid));
      const py = Math.round(bounds.minY + boxPxH * (gy / grid));
      const sx = Math.max(bounds.minX + 1, Math.min(bounds.maxX - 1, px));
      const sy = Math.max(bounds.minY + 1, Math.min(bounds.maxY - 1, py));
      const score = clearness(sx, sy, checkRadius);
      if (score > minClearness) seeds.push({ x: sx, y: sy, score });
    }
  }

  seeds.sort((a, b) => b.score - a.score);

  for (const seed of seeds) {
    const filled = floodFill(imageData, seed.x, seed.y, color, alpha, bounds);
    if (filled > 30) return filled;
  }

  // Last resort
  const cx = Math.round(bounds.minX + boxPxW / 2);
  const cy = Math.round(bounds.minY + boxPxH / 2);
  return floodFill(imageData, cx, cy, color, alpha, bounds);
}

// ── Component ───────────────────────────────────────────────────────────

export function FloodFillRenderer({ planImageUrl, rooms, plotInfo, accentColor, onRendered, height = 500 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const palette = PALETTES[accentColor ?? "graphite"] ?? PALETTES.graphite;

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRendering(true);
    setError(null);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("Image load failed")); img.src = planImageUrl; });

      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const legendH = 50;

      canvas.width = w;
      canvas.height = h + legendH;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, w, h);

      // Fill rooms — same type = same color
      const roomsWithBox = rooms.filter((r) => r.boundingBox);
      for (const room of roomsWithBox) {
        const type = classifyRoom(room.name);
        const color = palette[type];
        const filled = floodFillRoom(imageData, room.boundingBox!, w, h, color, 135);
        console.log(`[FloodFill] ${room.name} (${type}): ${filled}px`);
      }

      ctx.putImageData(imageData, 0, 0);

      // Labels
      for (const room of roomsWithBox) {
        const box = room.boundingBox!;
        const type = classifyRoom(room.name);
        const color = palette[type];
        const cx = Math.round((box.x + box.width / 2) * w);
        const cy = Math.round((box.y + box.height / 2) * h);
        const boxPxW = box.width * w;
        const boxPxH = box.height * h;

        const displayName = room.name.length > 14
          ? room.name.replace(/Room/gi, "Rm").replace(/Dressing/gi, "Dress").replace(/Common /gi, "C.").trim()
          : room.name;
        const sizeText = room.sizeEstimateSqm ? `${room.sizeEstimateSqm} m\u00B2` : "";
        const fontSize = Math.max(8, Math.min(13, Math.round(Math.min(boxPxW, boxPxH) * 0.08)));

        ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
        const nw = ctx.measureText(displayName).width;
        ctx.font = `${fontSize - 2}px Helvetica, Arial, sans-serif`;
        const sw = sizeText ? ctx.measureText(sizeText).width : 0;

        const pillW = Math.max(nw, sw) + 14;
        const pillH = sizeText ? fontSize * 2 + 10 : fontSize + 8;
        const pillX = cx - pillW / 2;
        const pillY = cy - pillH / 2;

        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 3);
        ctx.fill();
        ctx.strokeStyle = `rgba(${Math.round(color.r*0.6)},${Math.round(color.g*0.6)},${Math.round(color.b*0.6)},0.5)`;
        ctx.lineWidth = 0.6;
        ctx.stroke();

        ctx.fillStyle = "#1a1917";
        ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayName, cx, cy - (sizeText ? 4 : 0));

        if (sizeText) {
          ctx.fillStyle = "#6B7280";
          ctx.font = `${fontSize - 2}px Helvetica, Arial, sans-serif`;
          ctx.fillText(sizeText, cx, cy + fontSize - 2);
        }
      }

      // Legend
      const legendY = h;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, legendY, w, legendH);
      ctx.strokeStyle = "#E5E7EB";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, legendY); ctx.lineTo(w, legendY); ctx.stroke();

      const usedTypes = new Map<RoomType, string>();
      for (const room of roomsWithBox) {
        const type = classifyRoom(room.name);
        if (!usedTypes.has(type)) {
          const labels: Record<RoomType, string> = {
            bedroom: "Bedrooms", living: "Living", kitchen: "Kitchen", dining: "Dining",
            bathroom: "Bath", dressing: "Dressing", pooja: "Pooja", outdoor: "Outdoor",
            lobby: "Lobby", study: "Study", utility: "Utility", default: "Other",
          };
          usedTypes.set(type, labels[type]);
        }
      }

      const items = Array.from(usedTypes.entries());
      const totalW = items.length * 85;
      const startX = Math.max(16, (w - totalW) / 2);

      items.forEach(([type, label], i) => {
        const ix = startX + i * 85;
        const c = palette[type];
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.beginPath(); ctx.roundRect(ix, legendY + 16, 13, 13, 3); ctx.fill();
        ctx.strokeStyle = `rgb(${Math.round(c.r*0.7)},${Math.round(c.g*0.7)},${Math.round(c.b*0.7)})`;
        ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#374151";
        ctx.font = "500 9px Helvetica, Arial, sans-serif";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(label, ix + 18, legendY + 23);
      });

      // Compass
      if (plotInfo?.facing) {
        const compassX = w - 50, compassY = 50, r = 22;
        const facingDeg: Record<string, number> = { north:0,"north-east":45,east:90,"south-east":135,south:180,"south-west":225,west:270,"north-west":315 };
        const rot = (facingDeg[(plotInfo.facing).toLowerCase()] ?? 0) * Math.PI / 180;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath(); ctx.arc(compassX, compassY, r + 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#D1D5DB"; ctx.lineWidth = 1; ctx.stroke();
        ctx.save(); ctx.translate(compassX, compassY); ctx.rotate(rot);
        ctx.fillStyle = "#1F2937"; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-5, 3); ctx.lineTo(5, 3); ctx.fill();
        ctx.fillStyle = "#D1D5DB"; ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(-5, -3); ctx.lineTo(5, -3); ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#374151"; ctx.font = "bold 7px Helvetica"; ctx.textAlign = "center"; ctx.fillText("N", compassX, compassY - r - 4);
      }

      canvas.toBlob((blob) => { if (blob && onRendered) onRendered(blob); setRendering(false); }, "image/png");
    } catch (err) {
      console.error("Flood fill failed:", err);
      setError(err instanceof Error ? err.message : "Rendering failed");
      setRendering(false);
    }
  }, [planImageUrl, rooms, plotInfo, palette, onRendered]);

  useEffect(() => { render(); }, [render]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="w-full rounded-sm border border-stone-200"
        style={{ maxHeight: height, objectFit: "contain", imageRendering: "crisp-edges", display: error ? "none" : "block" }} />
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-sm">
          <div className="flex items-center gap-2">
            <span className="spinner w-4 h-4 text-stone-400" />
            <span className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">Rendering plan...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="border border-stone-200 rounded-sm p-8 text-center bg-stone-50">
          <p className="text-sm text-stone-400">Could not render color-coded plan</p>
        </div>
      )}
    </div>
  );
}
