"use client";

/**
 * components/FloodFillRenderer.tsx
 *
 * v4 — Nearest-room coloring (replaces flood fill entirely)
 *
 * For every light pixel in the plan image, find the closest room center
 * and tint it with that room's color. Dark pixels (walls, linework) stay
 * untouched.
 *
 * Why this is better than flood fill:
 *  - No seed points to find (the #1 failure mode of flood fill)
 *  - No wall threshold tuning
 *  - No leaking through doorways
 *  - Colors EVERY room, even tiny bathrooms full of fixtures
 *  - Runs in a single pass over the image
 *
 * The boundaries between rooms follow Voronoi edges (equidistant from
 * two room centers) which closely match where walls typically are.
 */

import { useRef, useState, useEffect, useCallback } from "react";

interface RoomData {
  name: string;
  sizeEstimateSqm?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}
interface PlotData { facing?: string; }
interface Props {
  planImageUrl: string;
  rooms: RoomData[];
  plotInfo?: PlotData;
  accentColor?: string;
  onRendered?: (pngBlob: Blob) => void;
  height?: number;
}

type RoomType = "bedroom"|"living"|"kitchen"|"dining"|"bathroom"|"dressing"|"pooja"|"outdoor"|"lobby"|"study"|"utility"|"default";

const PALETTES: Record<string, Record<RoomType, {r:number;g:number;b:number}>> = {
  graphite: {
    bedroom:{r:178,g:190,b:210}, living:{r:170,g:210,b:180}, kitchen:{r:230,g:210,b:150},
    dining:{r:220,g:190,b:170}, bathroom:{r:195,g:200,b:210}, dressing:{r:200,g:190,b:215},
    pooja:{r:235,g:200,b:155}, outdoor:{r:175,g:215,b:200}, lobby:{r:215,g:210,b:195},
    study:{r:185,g:200,b:220}, utility:{r:210,g:210,b:210}, default:{r:220,g:220,b:220},
  },
  navy: {
    bedroom:{r:170,g:190,b:225}, living:{r:165,g:210,b:195}, kitchen:{r:225,g:210,b:160},
    dining:{r:215,g:185,b:175}, bathroom:{r:185,g:195,b:215}, dressing:{r:190,g:185,b:220},
    pooja:{r:230,g:200,b:155}, outdoor:{r:170,g:215,b:210}, lobby:{r:205,g:210,b:225},
    study:{r:175,g:195,b:230}, utility:{r:200,g:205,b:215}, default:{r:215,g:220,b:225},
  },
  forest: {
    bedroom:{r:175,g:210,b:195}, living:{r:160,g:215,b:175}, kitchen:{r:225,g:215,b:160},
    dining:{r:220,g:195,b:170}, bathroom:{r:190,g:205,b:200}, dressing:{r:195,g:195,b:210},
    pooja:{r:230,g:200,b:150}, outdoor:{r:155,g:220,b:185}, lobby:{r:210,g:215,b:195},
    study:{r:180,g:210,b:200}, utility:{r:205,g:210,b:205}, default:{r:215,g:220,b:215},
  },
  terracotta: {
    bedroom:{r:215,g:190,b:180}, living:{r:195,g:215,b:180}, kitchen:{r:235,g:205,b:155},
    dining:{r:230,g:185,b:165}, bathroom:{r:205,g:200,b:195}, dressing:{r:210,g:195,b:205},
    pooja:{r:240,g:195,b:140}, outdoor:{r:185,g:215,b:195}, lobby:{r:225,g:215,b:195},
    study:{r:200,g:195,b:210}, utility:{r:210,g:205,b:200}, default:{r:220,g:215,b:210},
  },
  slate: {
    bedroom:{r:180,g:195,b:215}, living:{r:170,g:210,b:190}, kitchen:{r:225,g:215,b:165},
    dining:{r:215,g:190,b:180}, bathroom:{r:190,g:200,b:210}, dressing:{r:200,g:190,b:215},
    pooja:{r:230,g:200,b:155}, outdoor:{r:170,g:215,b:205}, lobby:{r:210,g:212,b:218},
    study:{r:185,g:200,b:225}, utility:{r:205,g:208,b:215}, default:{r:215,g:218,b:222},
  },
  plum: {
    bedroom:{r:200,g:185,b:215}, living:{r:175,g:210,b:190}, kitchen:{r:225,g:210,b:160},
    dining:{r:220,g:185,b:185}, bathroom:{r:200,g:195,b:210}, dressing:{r:210,g:190,b:220},
    pooja:{r:235,g:200,b:155}, outdoor:{r:175,g:215,b:200}, lobby:{r:215,g:205,b:220},
    study:{r:190,g:190,b:225}, utility:{r:208,g:205,b:212}, default:{r:218,g:215,b:222},
  },
};

function classifyRoom(name: string): RoomType {
  const n = name.toLowerCase();
  if (n.includes("bed") || n.includes("master")) return "bedroom";
  if (n.includes("living") || n.includes("drawing") || n.includes("sitting")) return "living";
  if (n.includes("kitchen") || n.includes("kit") || n.includes("serv")) return "kitchen";
  if (n.includes("dining") || n.includes("dinning")) return "dining";
  if (n.includes("toilet") || n.includes("bath") || n.includes("wc") || n.includes("c.toilet")) return "bathroom";
  if (n.includes("dress") || n.includes("wardrobe") || n.includes("w.i.w") || n.includes("w.i.c") || n.includes("closet")) return "dressing";
  if (n.includes("pooja") || n.includes("puja") || n.includes("prayer")) return "pooja";
  if (n.includes("balcon") || n.includes("terrace") || n.includes("porch") || n.includes("garden") || n.includes("green") || n.includes("lawn") || n.includes("deck") || n.includes("front open")) return "outdoor";
  if (n.includes("lobby") || n.includes("foyer") || n.includes("entry") || n.includes("stair") || n.includes("passage") || n.includes("lift") || n.includes("corridor")) return "lobby";
  if (n.includes("study") || n.includes("office")) return "study";
  if (n.includes("utility") || n.includes("laundry") || n.includes("store") || n.includes("maid")) return "utility";
  return "default";
}

// ── Nearest-room coloring ─────────────────────────────────────────────
// Single-pass: for each pixel, find closest room center, apply color.

function nearestRoomColor(
  imageData: ImageData,
  rooms: { cx: number; cy: number; color: { r: number; g: number; b: number } }[],
  wallBrightness: number = 100,  // pixels darker than this are walls — left untouched
  alpha: number = 0.30           // tint strength (0-1)
) {
  const { width, height, data } = imageData;

  // Pre-compute room center squared distances for each pixel would be
  // too slow for large images. Instead, downsample: assign each 4x4 block
  // to the nearest room, then paint all pixels in the block.
  const blockSize = 3;

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      // Find nearest room to this block's center
      const mx = bx + blockSize / 2;
      const my = by + blockSize / 2;

      let minDist = Infinity;
      let bestColor = rooms[0]?.color;

      for (const room of rooms) {
        const dx = mx - room.cx;
        const dy = my - room.cy;
        const d = dx * dx + dy * dy;
        if (d < minDist) {
          minDist = d;
          bestColor = room.color;
        }
      }

      if (!bestColor) continue;

      // Apply to all pixels in the block
      for (let py = by; py < Math.min(by + blockSize, height); py++) {
        for (let px = bx; px < Math.min(bx + blockSize, width); px++) {
          const i = (py * width + px) * 4;
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;

          // Skip dark pixels (walls, linework)
          if (brightness < wallBrightness) continue;

          // Skip pixels that are already strongly colored (hatching, fills)
          // Only tint white/light grey areas
          const saturation = Math.max(data[i], data[i+1], data[i+2]) - Math.min(data[i], data[i+1], data[i+2]);
          if (saturation > 60) continue;

          // Alpha-blend the room color
          data[i]     = Math.round(data[i] * (1 - alpha) + bestColor.r * alpha);
          data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + bestColor.g * alpha);
          data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + bestColor.b * alpha);
        }
      }
    }
  }
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

      // Build room center list
      const roomsWithBox = rooms.filter((r) => r.boundingBox);
      const roomCenters = roomsWithBox.map((room) => {
        const box = room.boundingBox!;
        const type = classifyRoom(room.name);
        return {
          cx: Math.round((box.x + box.width / 2) * w),
          cy: Math.round((box.y + box.height / 2) * h),
          color: palette[type],
          name: room.name,
          type,
        };
      });

      // Apply nearest-room coloring
      const imageData = ctx.getImageData(0, 0, w, h);
      nearestRoomColor(imageData, roomCenters, 100, 0.35);
      ctx.putImageData(imageData, 0, 0);

      // Draw subtle room boundaries (thin dashed lines between adjacent different-colored areas)
      // Not needed — the wall linework does this naturally

      // Labels
      for (const room of roomCenters) {
        const box = roomsWithBox.find(r => r.name === room.name)!.boundingBox!;
        const boxPxW = box.width * w;
        const boxPxH = box.height * h;

        const displayName = room.name.length > 14
          ? room.name.replace(/Room/gi, "Rm").replace(/Dressing/gi, "Dress").replace(/Common /gi, "C.").trim()
          : room.name;
        const sizeText = roomsWithBox.find(r => r.name === room.name)?.sizeEstimateSqm
          ? `${roomsWithBox.find(r => r.name === room.name)!.sizeEstimateSqm} m\u00B2` : "";
        const fontSize = Math.max(7, Math.min(12, Math.round(Math.min(boxPxW, boxPxH) * 0.07)));

        ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
        const nw = ctx.measureText(displayName).width;
        ctx.font = `${fontSize - 1}px Helvetica, Arial, sans-serif`;
        const sw = sizeText ? ctx.measureText(sizeText).width : 0;

        const pillW = Math.max(nw, sw) + 12;
        const pillH = sizeText ? fontSize * 2 + 8 : fontSize + 6;
        const pillX = room.cx - pillW / 2;
        const pillY = room.cy - pillH / 2;

        // Pill background
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.beginPath(); ctx.roundRect(pillX, pillY, pillW, pillH, 3); ctx.fill();
        ctx.strokeStyle = `rgba(${Math.round(room.color.r*0.5)},${Math.round(room.color.g*0.5)},${Math.round(room.color.b*0.5)},0.4)`;
        ctx.lineWidth = 0.5; ctx.stroke();

        // Name
        ctx.fillStyle = "#1a1917";
        ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(displayName, room.cx, room.cy - (sizeText ? 3 : 0));

        if (sizeText) {
          ctx.fillStyle = "#6B7280";
          ctx.font = `${fontSize - 1}px Helvetica, Arial, sans-serif`;
          ctx.fillText(sizeText, room.cx, room.cy + fontSize - 1);
        }
      }

      // Legend
      const legendY = h;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, legendY, w, legendH);
      ctx.strokeStyle = "#E5E7EB"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, legendY); ctx.lineTo(w, legendY); ctx.stroke();

      const usedTypes = new Map<RoomType, string>();
      const labels: Record<RoomType, string> = {
        bedroom:"Bedrooms", living:"Living", kitchen:"Kitchen", dining:"Dining",
        bathroom:"Bath", dressing:"Dressing", pooja:"Pooja", outdoor:"Outdoor",
        lobby:"Lobby", study:"Study", utility:"Utility", default:"Other",
      };
      for (const rc of roomCenters) { if (!usedTypes.has(rc.type)) usedTypes.set(rc.type, labels[rc.type]); }

      const items = Array.from(usedTypes.entries());
      const totalLW = items.length * 82;
      const startX = Math.max(12, (w - totalLW) / 2);
      items.forEach(([type, label], i) => {
        const ix = startX + i * 82;
        const c = palette[type];
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.beginPath(); ctx.roundRect(ix, legendY + 16, 12, 12, 2); ctx.fill();
        ctx.strokeStyle = `rgb(${Math.round(c.r*0.6)},${Math.round(c.g*0.6)},${Math.round(c.b*0.6)})`;
        ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#374151"; ctx.font = "500 9px Helvetica, Arial, sans-serif";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(label, ix + 16, legendY + 22);
      });

      // Compass
      if (plotInfo?.facing) {
        const cx = w - 45, cy = 45, r = 20;
        const facingDeg: Record<string,number> = {north:0,"north-east":45,east:90,"south-east":135,south:180,"south-west":225,west:270,"north-west":315};
        const rot = (facingDeg[(plotInfo.facing).toLowerCase()] ?? 0) * Math.PI / 180;
        ctx.fillStyle = "rgba(255,255,255,0.93)";
        ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#D1D5DB"; ctx.lineWidth = 1; ctx.stroke();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
        ctx.fillStyle = "#1F2937"; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-4, 3); ctx.lineTo(4, 3); ctx.fill();
        ctx.fillStyle = "#D1D5DB"; ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(-4, -3); ctx.lineTo(4, -3); ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#374151"; ctx.font = "bold 7px Helvetica"; ctx.textAlign = "center"; ctx.fillText("N", cx, cy - r - 3);
      }

      canvas.toBlob((blob) => { if (blob && onRendered) onRendered(blob); setRendering(false); }, "image/png");
    } catch (err) {
      console.error("Rendering failed:", err);
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
