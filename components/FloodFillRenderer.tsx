"use client";

/**
 * components/FloodFillRenderer.tsx — v5
 *
 * Wall-masked Voronoi coloring:
 *  1. Assign each pixel a room color based on nearest room center
 *  2. BUT skip dark pixels (walls) — they keep their original appearance
 *  3. AND only color within the plan boundary (excludes title block, margins)
 *  4. Smooth edge treatment: fade alpha near walls for clean transitions
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
  if (n.includes("dress") || n.includes("wardrobe") || n.includes("w.i.") || n.includes("closet")) return "dressing";
  if (n.includes("pooja") || n.includes("puja") || n.includes("prayer")) return "pooja";
  if (n.includes("balcon") || n.includes("terrace") || n.includes("porch") || n.includes("garden") || n.includes("green") || n.includes("lawn") || n.includes("deck") || n.includes("front open")) return "outdoor";
  if (n.includes("lobby") || n.includes("foyer") || n.includes("entry") || n.includes("stair") || n.includes("passage") || n.includes("lift") || n.includes("corridor")) return "lobby";
  if (n.includes("study") || n.includes("office")) return "study";
  if (n.includes("utility") || n.includes("laundry") || n.includes("store") || n.includes("maid")) return "utility";
  return "default";
}

// ── Wall-masked Voronoi coloring ────────────────────────────────────────

function applyRoomColors(
  imageData: ImageData,
  rooms: { cx: number; cy: number; color: { r: number; g: number; b: number }; name: string }[],
  planBounds: { x1: number; y1: number; x2: number; y2: number }
) {
  const { width, height, data } = imageData;
  const BLOCK = 2; // process in 2x2 blocks for speed
  const WALL_DARK = 90;  // pixels darker than this are walls
  const ALPHA = 0.32;    // tint strength

  // Pre-build a "wall proximity" map: for each pixel, how close is the nearest wall?
  // This lets us fade the color near walls for smooth transitions.
  // (simplified: just check immediate neighborhood instead of full distance map)

  for (let by = 0; by < height; by += BLOCK) {
    for (let bx = 0; bx < width; bx += BLOCK) {
      // Skip pixels outside the plan boundary (title block, margins)
      if (bx < planBounds.x1 || bx > planBounds.x2 || by < planBounds.y1 || by > planBounds.y2) continue;

      // Check center pixel of block
      const ci = (by * width + bx) * 4;
      const brightness = (data[ci] + data[ci + 1] + data[ci + 2]) / 3;

      // Skip wall pixels — keep them as-is
      if (brightness < WALL_DARK) continue;

      // Skip already-colored pixels (hatching, fills in the original)
      const sat = Math.max(data[ci], data[ci+1], data[ci+2]) - Math.min(data[ci], data[ci+1], data[ci+2]);
      if (sat > 50) continue;

      // Check if near a wall (within 3px) — reduce alpha for smooth edge
      let nearWall = false;
      for (const [dx, dy] of [[-3,0],[3,0],[0,-3],[0,3]] as const) {
        const nx = bx + dx, ny = by + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = (ny * width + nx) * 4;
          if ((data[ni] + data[ni+1] + data[ni+2]) / 3 < WALL_DARK) {
            nearWall = true;
            break;
          }
        }
      }

      const alpha = nearWall ? ALPHA * 0.5 : ALPHA;

      // Find nearest room
      let minDist = Infinity;
      let bestColor = rooms[0]?.color;

      for (const room of rooms) {
        const dx = bx - room.cx;
        const dy = by - room.cy;
        const d = dx * dx + dy * dy;
        if (d < minDist) { minDist = d; bestColor = room.color; }
      }

      if (!bestColor) continue;

      // Apply to all pixels in the block
      for (let py = by; py < Math.min(by + BLOCK, height); py++) {
        for (let px = bx; px < Math.min(bx + BLOCK, width); px++) {
          const i = (py * width + px) * 4;
          const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (b < WALL_DARK) continue; // per-pixel wall check
          const s = Math.max(data[i], data[i+1], data[i+2]) - Math.min(data[i], data[i+1], data[i+2]);
          if (s > 50) continue;

          data[i]     = Math.round(data[i] * (1 - alpha) + bestColor.r * alpha);
          data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + bestColor.g * alpha);
          data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + bestColor.b * alpha);
        }
      }
    }
  }
}

// Detect plan boundary — the bounding box of all room centers, padded
function detectPlanBounds(
  rooms: { cx: number; cy: number }[],
  imgW: number, imgH: number,
  padding: number = 60
): { x1: number; y1: number; x2: number; y2: number } {
  if (rooms.length === 0) return { x1: 0, y1: 0, x2: imgW, y2: imgH };

  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const r of rooms) {
    minX = Math.min(minX, r.cx);
    minY = Math.min(minY, r.cy);
    maxX = Math.max(maxX, r.cx);
    maxY = Math.max(maxY, r.cy);
  }

  return {
    x1: Math.max(0, minX - padding),
    y1: Math.max(0, minY - padding),
    x2: Math.min(imgW - 1, maxX + padding),
    y2: Math.min(imgH - 1, maxY + padding),
  };
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
    setRendering(true); setError(null);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("Image load failed")); img.src = planImageUrl; });

      const w = img.naturalWidth, h = img.naturalHeight;
      const legendH = 50;

      canvas.width = w; canvas.height = h + legendH;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Build room data
      const roomsWithBox = rooms.filter((r) => r.boundingBox);
      const roomCenters = roomsWithBox.map((room) => {
        const box = room.boundingBox!;
        return {
          cx: Math.round((box.x + box.width / 2) * w),
          cy: Math.round((box.y + box.height / 2) * h),
          color: palette[classifyRoom(room.name)],
          name: room.name,
          type: classifyRoom(room.name),
        };
      });

      // Detect plan boundary to exclude title block
      const planBounds = detectPlanBounds(roomCenters, w, h, Math.round(w * 0.08));

      // Apply wall-masked Voronoi coloring
      const imageData = ctx.getImageData(0, 0, w, h);
      applyRoomColors(imageData, roomCenters, planBounds);
      ctx.putImageData(imageData, 0, 0);

      // Draw room labels
      for (const room of roomCenters) {
        const box = roomsWithBox.find(r => r.name === room.name)!.boundingBox!;
        const boxW = box.width * w, boxH = box.height * h;

        const displayName = room.name.length > 14
          ? room.name.replace(/Room/gi, "Rm").replace(/Dressing/gi, "Dress").replace(/Common /gi, "C.").trim()
          : room.name;
        const sqm = roomsWithBox.find(r => r.name === room.name)?.sizeEstimateSqm;
        const sizeText = sqm ? `${sqm} m\u00B2` : "";
        const fontSize = Math.max(7, Math.min(12, Math.round(Math.min(boxW, boxH) * 0.07)));

        ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
        const nw = ctx.measureText(displayName).width;
        ctx.font = `${fontSize - 1}px Helvetica, Arial, sans-serif`;
        const sw = sizeText ? ctx.measureText(sizeText).width : 0;

        const pillW = Math.max(nw, sw) + 12;
        const pillH = sizeText ? fontSize * 2 + 8 : fontSize + 6;
        const px = room.cx - pillW / 2, py = room.cy - pillH / 2;

        // Pill
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, 3); ctx.fill();
        const c = room.color;
        ctx.strokeStyle = `rgba(${c.r*0.5|0},${c.g*0.5|0},${c.b*0.5|0},0.35)`;
        ctx.lineWidth = 0.5; ctx.stroke();

        ctx.fillStyle = "#1a1917"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
        ctx.fillText(displayName, room.cx, room.cy - (sizeText ? 3 : 0));
        if (sizeText) {
          ctx.fillStyle = "#6B7280"; ctx.font = `${fontSize-1}px Helvetica, Arial, sans-serif`;
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
      for (const rc of roomCenters) if (!usedTypes.has(rc.type)) usedTypes.set(rc.type, labels[rc.type]);

      const items = Array.from(usedTypes.entries());
      const totalLW = items.length * 82;
      const startX = Math.max(12, (w - totalLW) / 2);
      items.forEach(([type, label], i) => {
        const ix = startX + i * 82;
        const cl = palette[type];
        ctx.fillStyle = `rgb(${cl.r},${cl.g},${cl.b})`;
        ctx.beginPath(); ctx.roundRect(ix, legendY + 16, 12, 12, 2); ctx.fill();
        ctx.strokeStyle = `rgb(${cl.r*0.6|0},${cl.g*0.6|0},${cl.b*0.6|0})`;
        ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#374151"; ctx.font = "500 9px Helvetica, Arial, sans-serif";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(label, ix + 16, legendY + 22);
      });

      // Compass
      if (plotInfo?.facing) {
        const cx = w - 45, cy = 45, r = 20;
        const fd: Record<string,number> = {north:0,"north-east":45,east:90,"south-east":135,south:180,"south-west":225,west:270,"north-west":315};
        const rot = (fd[plotInfo.facing.toLowerCase()] ?? 0) * Math.PI / 180;
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
      console.error("Render failed:", err);
      setError(err instanceof Error ? err.message : "Failed");
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
            <span className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">Rendering…</span>
          </div>
        </div>
      )}
      {error && (
        <div className="border border-stone-200 rounded-sm p-8 text-center bg-stone-50">
          <p className="text-sm text-stone-400">Rendering failed</p>
        </div>
      )}
    </div>
  );
}
