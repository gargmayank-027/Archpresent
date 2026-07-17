"use client";

/**
 * components/FloodFillRenderer.tsx — v6
 *
 * Wall-closed segmentation + Voronoi fallback:
 *  1. Segment the plan into connected components separated by wall pixels
 *     (a real flood fill bounded by walls, not just distance-based)
 *  2. Assign each component the color of the single room center it
 *     contains; components with 2+ centers (open-plan areas) fall back to
 *     nearest-center Voronoi, but only among rooms in that same component
 *  3. Skip dark pixels (walls) — they keep their original appearance
 *  4. Only color within the plan boundary (excludes title block, margins)
 *  5. Smooth edge treatment: fade alpha near walls for clean transitions
 *
 * v5 used nearest-center distance alone, which could bleed a room's tint
 * across a real wall into its neighbor whenever the neighbor's center was
 * closer in a straight line. v6 fixes that at the source.
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

// ── Wall-closed segmentation + Voronoi fallback ─────────────────────────
//
// v5 colored every pixel by nearest room-center distance alone. That let
// color bleed across a real wall whenever a neighboring room's center
// happened to be closer in a straight line — distance doesn't know a wall
// is in the way. v6 fixes this by first grouping pixels into connected
// components separated by wall pixels (a flood fill bounded by walls,
// same idea as FloodFillRenderer's name originally promised), then only
// falling back to nearest-center Voronoi *within* a single component —
// i.e. only between rooms that are actually reachable from each other
// without crossing a wall (open-plan layouts, wide archways).

const BLOCK = 2;       // sampling grid — matches original block-processing resolution
const WALL_DARK = 90;  // pixels darker than this are walls
const ALPHA = 0.32;    // tint strength
const NEAR_WALL_PX = 3;

interface RoomCenter { cx: number; cy: number; color: { r: number; g: number; b: number }; name: string }

/** Sample the image down to a BLOCK-resolution grid of wall/open cells. */
function buildWallGrid(
  imageData: ImageData,
  planBounds: { x1: number; y1: number; x2: number; y2: number }
): { isWall: Uint8Array; gridW: number; gridH: number } {
  const { width, height, data } = imageData;
  const gridW = Math.ceil(width / BLOCK);
  const gridH = Math.ceil(height / BLOCK);
  const isWall = new Uint8Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const px = gx * BLOCK;
      const py = gy * BLOCK;
      const idx = gy * gridW + gx;
      // Treat anything outside the detected plan boundary (title block,
      // margins) as a hard boundary too, so it can never connect two rooms.
      if (px < planBounds.x1 || px > planBounds.x2 || py < planBounds.y1 || py > planBounds.y2 || px >= width || py >= height) {
        isWall[idx] = 1;
        continue;
      }
      const i = (py * width + px) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      isWall[idx] = brightness < WALL_DARK ? 1 : 0;
    }
  }
  return { isWall, gridW, gridH };
}

/**
 * Morphological closing (dilate then erode by one cell) on the wall mask.
 * This bridges 1-cell scan noise / anti-aliased gaps in a wall line so
 * they don't leak color through — WITHOUT closing real doorways, which
 * at this grid resolution are typically 6+ cells wide and survive a
 * single-cell closing untouched.
 */
function closeWallGrid(isWall: Uint8Array, gridW: number, gridH: number): Uint8Array {
  const at = (g: Uint8Array, x: number, y: number) =>
    x < 0 || y < 0 || x >= gridW || y >= gridH ? 1 : g[y * gridW + x];

  const dilated = new Uint8Array(isWall.length);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      let wall = 0;
      for (let dy = -1; dy <= 1 && !wall; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (at(isWall, x + dx, y + dy)) { wall = 1; break; }
        }
      }
      dilated[y * gridW + x] = wall;
    }
  }

  const closed = new Uint8Array(isWall.length);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      let allWall = 1;
      for (let dy = -1; dy <= 1 && allWall; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!at(dilated, x + dx, y + dy)) { allWall = 0; break; }
        }
      }
      closed[y * gridW + x] = allWall;
    }
  }
  return closed;
}

/** 4-connected flood fill labeling of open (non-wall) cells. -1 = wall. */
function labelComponents(isWall: Uint8Array, gridW: number, gridH: number): Int32Array {
  const labels = new Int32Array(gridW * gridH).fill(-1);
  const queue = new Int32Array(gridW * gridH);
  let nextId = 0;

  for (let start = 0; start < gridW * gridH; start++) {
    if (isWall[start] || labels[start] !== -1) continue;
    let qHead = 0, qTail = 0;
    queue[qTail++] = start;
    labels[start] = nextId;
    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % gridW, y = (idx / gridW) | 0;
      const neighbors: [number, number][] = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        const nIdx = ny * gridW + nx;
        if (isWall[nIdx] || labels[nIdx] !== -1) continue;
        labels[nIdx] = nextId;
        queue[qTail++] = nIdx;
      }
    }
    nextId++;
  }
  return labels;
}

/** Find the nearest open (non-wall) cell to a room center, spiraling outward. */
function nearestOpenCellIndex(labels: Int32Array, gridW: number, gridH: number, gx: number, gy: number): number {
  if (gx >= 0 && gy >= 0 && gx < gridW && gy < gridH && labels[gy * gridW + gx] !== -1) return gy * gridW + gx;
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        const idx = ny * gridW + nx;
        if (labels[idx] !== -1) return idx;
      }
    }
  }
  return -1;
}

function applyRoomColors(
  imageData: ImageData,
  rooms: RoomCenter[],
  planBounds: { x1: number; y1: number; x2: number; y2: number }
) {
  const { width, height, data } = imageData;

  // 1. Segment the plan into wall-bounded connected components.
  const { isWall: rawWall, gridW, gridH } = buildWallGrid(imageData, planBounds);
  const closedWall = closeWallGrid(rawWall, gridW, gridH);
  const labels = labelComponents(closedWall, gridW, gridH);

  // 2. Assign each room center to the component it physically sits in.
  const componentRooms = new Map<number, RoomCenter[]>();
  for (const room of rooms) {
    const gx = Math.floor(room.cx / BLOCK);
    const gy = Math.floor(room.cy / BLOCK);
    const cellIdx = nearestOpenCellIndex(labels, gridW, gridH, gx, gy);
    if (cellIdx === -1) continue;
    const compId = labels[cellIdx];
    if (!componentRooms.has(compId)) componentRooms.set(compId, []);
    componentRooms.get(compId)!.push(room);
  }

  // 3. Resolve one color per grid cell. A component with exactly one room
  //    gets that room's color uniformly (correct for a fully-enclosed
  //    room). A component with 2+ rooms is an open-plan area — fall back
  //    to nearest-center Voronoi, but ONLY among rooms known to share that
  //    component, so a room across a real wall is never in contention.
  //    A component with zero assigned rooms (an unclaimed pocket, e.g. a
  //    duct shaft) is left untinted rather than guessed at.
  const cellColor: ({ r: number; g: number; b: number } | null)[] = new Array(gridW * gridH).fill(null);
  for (let idx = 0; idx < gridW * gridH; idx++) {
    if (labels[idx] === -1) continue;
    const roomsInComp = componentRooms.get(labels[idx]);
    if (!roomsInComp || roomsInComp.length === 0) continue;
    if (roomsInComp.length === 1) { cellColor[idx] = roomsInComp[0].color; continue; }

    const gx = idx % gridW, gy = (idx / gridW) | 0;
    const px = gx * BLOCK, py = gy * BLOCK;
    let best = roomsInComp[0], bestD = Infinity;
    for (const r of roomsInComp) {
      const dx = px - r.cx, dy = py - r.cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = r; }
    }
    cellColor[idx] = best.color;
  }

  // 4. Paint. Same per-pixel wall/saturation checks and near-wall alpha
  //    fade as before — only the color lookup changed (grid cell, not a
  //    fresh global nearest-room search).
  for (let by = 0; by < height; by += BLOCK) {
    for (let bx = 0; bx < width; bx += BLOCK) {
      if (bx < planBounds.x1 || bx > planBounds.x2 || by < planBounds.y1 || by > planBounds.y2) continue;

      const ci = (by * width + bx) * 4;
      const brightness = (data[ci] + data[ci + 1] + data[ci + 2]) / 3;
      if (brightness < WALL_DARK) continue;

      const sat = Math.max(data[ci], data[ci + 1], data[ci + 2]) - Math.min(data[ci], data[ci + 1], data[ci + 2]);
      if (sat > 50) continue;

      const gx = Math.floor(bx / BLOCK), gy = Math.floor(by / BLOCK);
      const bestColor = cellColor[gy * gridW + gx];
      if (!bestColor) continue;

      let nearWall = false;
      for (const [dx, dy] of [[-NEAR_WALL_PX, 0], [NEAR_WALL_PX, 0], [0, -NEAR_WALL_PX], [0, NEAR_WALL_PX]] as const) {
        const nx = bx + dx, ny = by + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = (ny * width + nx) * 4;
          if ((data[ni] + data[ni + 1] + data[ni + 2]) / 3 < WALL_DARK) { nearWall = true; break; }
        }
      }
      const alpha = nearWall ? ALPHA * 0.5 : ALPHA;

      for (let py = by; py < Math.min(by + BLOCK, height); py++) {
        for (let px = bx; px < Math.min(bx + BLOCK, width); px++) {
          const i = (py * width + px) * 4;
          const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (b < WALL_DARK) continue;
          const s = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
          if (s > 50) continue;

          data[i]     = Math.round(data[i] * (1 - alpha) + bestColor.r * alpha);
          data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + bestColor.g * alpha);
          data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + bestColor.b * alpha);
        }
      }
    }
  }
}

// Detect plan boundary — the bounding box of every room's actual extent
// (all four corners), padded just enough to cover wall thickness.
//
// The previous version used only room CENTERS (a single point per room)
// padded by a flat 8% of image width. A center-based box is a crude stand-in
// for the real building footprint: whichever edge has fewer rooms pulling
// it inward ends up under-constrained, and an 8%-of-image-width pad (~120px
// on a 1500px plan) is generous enough to push that edge well past the
// actual walls into the blank margin or title block — which is exactly the
// bleed visible in the Review tab. Using every room's full box extent
// tracks the real footprint much more tightly, so a small fixed pad (just
// covering wall thickness) is enough.
function detectPlanBounds(
  rooms: { cx: number; cy: number; boxX1?: number; boxY1?: number; boxX2?: number; boxY2?: number }[],
  imgW: number, imgH: number,
  padding: number = 16
): { x1: number; y1: number; x2: number; y2: number } {
  if (rooms.length === 0) return { x1: 0, y1: 0, x2: imgW, y2: imgH };

  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const r of rooms) {
    const x1 = r.boxX1 ?? r.cx, y1 = r.boxY1 ?? r.cy;
    const x2 = r.boxX2 ?? r.cx, y2 = r.boxY2 ?? r.cy;
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
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
          boxX1: Math.round(box.x * w),
          boxY1: Math.round(box.y * h),
          boxX2: Math.round((box.x + box.width) * w),
          boxY2: Math.round((box.y + box.height) * h),
          color: palette[classifyRoom(room.name)],
          name: room.name,
          type: classifyRoom(room.name),
        };
      });

      // Detect plan boundary to exclude title block — tight padding now that
      // this tracks each room's real extent rather than just its center.
      const planBounds = detectPlanBounds(roomCenters, w, h);

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
