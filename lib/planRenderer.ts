/**
 * lib/planRenderer.ts
 *
 * Color-coded floor plan renderer. Composites SVG room overlays onto the
 * original plan image using Sharp.
 *
 * Approach: use Sharp's extend() to add a white legend strip below the
 * plan, then composite a single SVG overlay with room fills, labels,
 * compass, and legend. This avoids the fragile sharp({ create }) pattern
 * that was silently failing on Vercel.
 */

import type { RoomDetail, PlotInfo, RoomBoundingBox } from "@/types";

// ── Room type → color mapping ──────────────────────────────────────────────

interface RoomColor {
  fill: string;
  stroke: string;
  label: string;
}

const ROOM_COLORS: Record<string, RoomColor> = {
  bedroom:    { fill: "#BFDBFE", stroke: "#3B82F6", label: "Bedrooms" },
  living:     { fill: "#BBF7D0", stroke: "#22C55E", label: "Living" },
  kitchen:    { fill: "#FDE68A", stroke: "#F59E0B", label: "Kitchen" },
  dining:     { fill: "#FECACA", stroke: "#EF4444", label: "Dining" },
  bathroom:   { fill: "#D1D5DB", stroke: "#6B7280", label: "Bath" },
  dressing:   { fill: "#DDD6FE", stroke: "#8B5CF6", label: "Dressing" },
  pooja:      { fill: "#FED7AA", stroke: "#EA580C", label: "Pooja" },
  outdoor:    { fill: "#99F6E4", stroke: "#14B8A6", label: "Outdoor" },
  lobby:      { fill: "#FEF08A", stroke: "#CA8A04", label: "Lobby" },
  study:      { fill: "#BAE6FD", stroke: "#0284C7", label: "Study" },
  utility:    { fill: "#E5E7EB", stroke: "#9CA3AF", label: "Utility" },
  default:    { fill: "#F3F4F6", stroke: "#D1D5DB", label: "Other" },
};

function getRoomColor(roomName: string): RoomColor {
  const n = roomName.toLowerCase();
  if (n.includes("bed") || n.includes("master"))  return ROOM_COLORS.bedroom;
  if (n.includes("living") || n.includes("drawing") || n.includes("sitting")) return ROOM_COLORS.living;
  if (n.includes("kitchen") || n.includes("kit wash") || n.includes("pantry") || n.includes("serv")) return ROOM_COLORS.kitchen;
  if (n.includes("dining") || n.includes("dinning")) return ROOM_COLORS.dining;
  if (n.includes("toilet") || n.includes("bath") || n.includes("wc") || n.includes("powder")) return ROOM_COLORS.bathroom;
  if (n.includes("dress") || n.includes("wardrobe") || n.includes("w.i.w") || n.includes("wic") || n.includes("closet")) return ROOM_COLORS.dressing;
  if (n.includes("pooja") || n.includes("puja") || n.includes("prayer") || n.includes("mandir")) return ROOM_COLORS.pooja;
  if (n.includes("balcon") || n.includes("terrace") || n.includes("porch") || n.includes("garden") || n.includes("green") || n.includes("lawn")) return ROOM_COLORS.outdoor;
  if (n.includes("lobby") || n.includes("foyer") || n.includes("entry") || n.includes("stair") || n.includes("passage") || n.includes("lift")) return ROOM_COLORS.lobby;
  if (n.includes("study") || n.includes("office") || n.includes("library")) return ROOM_COLORS.study;
  if (n.includes("utility") || n.includes("laundry") || n.includes("store") || n.includes("maid")) return ROOM_COLORS.utility;
  return ROOM_COLORS.default;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── SVG overlay builder ────────────────────────────────────────────────────

function buildOverlaySvg(
  imgWidth: number,
  totalHeight: number,
  planHeight: number,
  rooms: RoomDetail[],
  plotInfo?: PlotInfo
): string {
  const roomsWithBox = rooms.filter((r) => r.boundingBox);

  // ── Room overlays ──
  const roomRects = roomsWithBox.map((room) => {
    const box = room.boundingBox!;
    const color = getRoomColor(room.name);

    const x = Math.round(box.x * imgWidth);
    const y = Math.round(box.y * planHeight);
    const w = Math.round(box.width * imgWidth);
    const h = Math.round(box.height * planHeight);

    const minDim = Math.min(w, h);
    const fontSize = Math.max(10, Math.min(16, Math.round(minDim * 0.10)));
    const sizeFont = Math.max(8, fontSize - 2);

    const displayName = w < 100
      ? room.name.replace(/Room/gi, "Rm").replace(/Area/gi, "").replace(/Dressing/gi, "Dress").trim()
      : room.name;
    const sizeLabel = room.sizeEstimateSqm ? `${room.sizeEstimateSqm} m` : "";

    // Label pill
    const nameW = displayName.length * fontSize * 0.58;
    const sizeW = sizeLabel ? sizeLabel.length * sizeFont * 0.6 : 0;
    const pillW = Math.max(nameW, sizeW) + 20;
    const pillH = sizeLabel ? fontSize + sizeFont + 16 : fontSize + 12;
    const pillX = x + w / 2 - pillW / 2;
    const pillY = y + h / 2 - pillH / 2;

    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
        fill="${color.fill}" fill-opacity="0.7"
        stroke="${color.stroke}" stroke-width="2.5" rx="3" />
      <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}"
        fill="white" fill-opacity="0.93" rx="4"
        stroke="${color.stroke}" stroke-width="0.8" />
      <text x="${x + w / 2}" y="${pillY + (sizeLabel ? fontSize + 3 : pillH / 2 + 1)}"
        text-anchor="middle" dominant-baseline="middle"
        font-family="Helvetica, Arial, sans-serif"
        font-size="${fontSize}" font-weight="700" fill="#1a1917">
        ${escapeXml(displayName)}
      </text>
      ${sizeLabel ? `
        <text x="${x + w / 2}" y="${pillY + fontSize + sizeFont + 7}"
          text-anchor="middle" dominant-baseline="middle"
          font-family="Helvetica, Arial, sans-serif"
          font-size="${sizeFont}" fill="#6B7280">
          ${sizeLabel}
        </text>
      ` : ""}
    `;
  }).join("\n");

  // ── Compass ──
  const compass = plotInfo?.facing ? (() => {
    const cx = imgWidth - 55;
    const cy = 55;
    const r = 28;
    const facingDeg: Record<string, number> = {
      north: 0, "north-east": 45, east: 90, "south-east": 135,
      south: 180, "south-west": 225, west: 270, "north-west": 315,
    };
    const rot = facingDeg[(plotInfo.facing ?? "").toLowerCase()] ?? 0;
    return `
      <g transform="translate(${cx}, ${cy})">
        <circle r="${r + 7}" fill="white" fill-opacity="0.95" stroke="#D1D5DB" stroke-width="1.5" />
        <g transform="rotate(${rot})">
          <polygon points="0,${-r} -6,4 6,4" fill="#1F2937" />
          <polygon points="0,${r} -6,-4 6,-4" fill="#D1D5DB" />
          <line x1="${-r + 8}" y1="0" x2="${r - 8}" y2="0" stroke="#E5E7EB" stroke-width="1.5" />
        </g>
        <text x="0" y="${-r - 5}" text-anchor="middle"
          font-family="Helvetica, Arial, sans-serif"
          font-size="8" font-weight="700" fill="#374151">N</text>
      </g>
    `;
  })() : "";

  // ── Legend ──
  const legendItems: { color: RoomColor; label: string }[] = [];
  const seen = new Set<string>();
  for (const room of roomsWithBox) {
    const color = getRoomColor(room.name);
    if (!seen.has(color.label)) {
      seen.add(color.label);
      legendItems.push({ color, label: color.label });
    }
  }

  const legendY = planHeight;
  const totalItemsWidth = legendItems.length * 90;
  const startX = Math.max(16, (imgWidth - totalItemsWidth) / 2);

  const legendSvg = legendItems.map((item, i) => {
    const ix = startX + i * 90;
    return `
      <rect x="${ix}" y="${legendY + 14}" width="14" height="14" rx="3"
        fill="${item.color.fill}" stroke="${item.color.stroke}" stroke-width="1.5" />
      <text x="${ix + 22}" y="${legendY + 25}"
        font-family="Helvetica, Arial, sans-serif"
        font-size="10" fill="#374151" font-weight="500">
        ${item.label}
      </text>
    `;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg"
    width="${imgWidth}" height="${totalHeight}"
    viewBox="0 0 ${imgWidth} ${totalHeight}">
    ${roomRects}
    ${compass}
    <line x1="0" y1="${legendY}" x2="${imgWidth}" y2="${legendY}" stroke="#E5E7EB" stroke-width="1" />
    ${legendSvg}
  </svg>`;
}

// ── Main renderer ──────────────────────────────────────────────────────────

export async function renderColorCodedPlan(
  planImagePath: string,
  rooms: RoomDetail[],
  plotInfo?: PlotInfo
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  // Load the original plan image
  let inputBuffer: Buffer;
  if (planImagePath.startsWith("http")) {
    const res = await fetch(planImagePath);
    if (!res.ok) throw new Error(`Failed to fetch plan image: HTTP ${res.status}`);
    inputBuffer = Buffer.from(await res.arrayBuffer());
  } else {
    const { readFileSync } = await import("fs");
    inputBuffer = readFileSync(planImagePath);
  }

  const metadata = await sharp(inputBuffer).metadata();
  const imgWidth = metadata.width ?? 1200;
  const imgHeight = metadata.height ?? 800;
  const legendH = 48;
  const totalH = imgHeight + legendH;

  // Step 1: extend the plan image with a white strip for the legend
  const extendedPlan = await sharp(inputBuffer)
    .extend({
      top: 0, left: 0, right: 0,
      bottom: legendH,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    })
    .png()
    .toBuffer();

  // Step 2: build the SVG overlay
  const svg = buildOverlaySvg(imgWidth, totalH, imgHeight, rooms, plotInfo);
  const svgBuffer = Buffer.from(svg);

  // Step 3: composite SVG on top of the extended plan
  const result = await sharp(extendedPlan)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();

  console.log(`[planRenderer] Rendered: ${(result.length / 1024).toFixed(0)}KB, ${imgWidth}x${totalH}, ${rooms.filter(r => r.boundingBox).length} rooms`);
  return result;
}

/**
 * Render and save the color-coded plan to disk/blob, returning the URL.
 */
export async function renderAndSavePlan(
  planImagePath: string,
  projectId: string,
  rooms: RoomDetail[],
  plotInfo?: PlotInfo
): Promise<string> {
  const { saveUploadedFile } = await import("@/lib/store");
  const buffer = await renderColorCodedPlan(planImagePath, rooms, plotInfo);
  const filename = `plan-${projectId}-rendered.png`;
  const { url } = await saveUploadedFile(buffer, filename);
  return url;
}
