/**
 * lib/planRenderer.ts
 *
 * Transforms a B&W architectural floor plan into a color-coded,
 * labeled version suitable for client presentations.
 *
 * Uses the room detection data (bounding boxes, types, sizes) to
 * generate an SVG overlay composited onto the original plan via Sharp.
 *
 * The output looks like a real estate brochure plan — each room type
 * gets a distinct pastel fill, clean labels with name + area, compass
 * rose in the corner, and a legend strip at the bottom.
 */

import type { RoomDetail, PlotInfo, RoomBoundingBox } from "@/types";

// ── Room type → color mapping ──────────────────────────────────────────────

interface RoomColor {
  fill: string;    // pastel fill for the overlay
  stroke: string;  // darker border
  label: string;   // for the legend
}

const ROOM_COLORS: Record<string, RoomColor> = {
  // Bedrooms — calm blue
  bedroom:    { fill: "#BFDBFE", stroke: "#3B82F6", label: "Bedrooms" },
  // Living / Drawing — warm green
  living:     { fill: "#BBF7D0", stroke: "#22C55E", label: "Living" },
  // Kitchen — warm amber
  kitchen:    { fill: "#FDE68A", stroke: "#F59E0B", label: "Kitchen" },
  // Dining — soft coral
  dining:     { fill: "#FECACA", stroke: "#EF4444", label: "Dining" },
  // Bathroom / Toilet — cool grey
  bathroom:   { fill: "#D1D5DB", stroke: "#6B7280", label: "Bath" },
  // Dressing / Wardrobe — soft purple
  dressing:   { fill: "#DDD6FE", stroke: "#8B5CF6", label: "Dressing" },
  // Pooja / Prayer — saffron
  pooja:      { fill: "#FED7AA", stroke: "#EA580C", label: "Pooja" },
  // Balcony / Outdoor — teal
  outdoor:    { fill: "#99F6E4", stroke: "#14B8A6", label: "Outdoor" },
  // Lobby / Entry — warm cream
  lobby:      { fill: "#FEF08A", stroke: "#CA8A04", label: "Lobby" },
  // Study / Office — steel blue
  study:      { fill: "#BAE6FD", stroke: "#0284C7", label: "Study" },
  // Utility — muted
  utility:    { fill: "#E5E7EB", stroke: "#9CA3AF", label: "Utility" },
  // Default
  default:    { fill: "#F3F4F6", stroke: "#D1D5DB", label: "Other" },
};

function getRoomColor(roomName: string): RoomColor {
  const n = roomName.toLowerCase();

  if (n.includes("bed") || n.includes("master"))  return ROOM_COLORS.bedroom;
  if (n.includes("living") || n.includes("drawing") || n.includes("sitting"))
    return ROOM_COLORS.living;
  if (n.includes("kitchen") || n.includes("kit wash") || n.includes("pantry"))
    return ROOM_COLORS.kitchen;
  if (n.includes("dining"))   return ROOM_COLORS.dining;
  if (n.includes("toilet") || n.includes("bath") || n.includes("wc") || n.includes("powder"))
    return ROOM_COLORS.bathroom;
  if (n.includes("dress") || n.includes("wardrobe") || n.includes("w.i.w") || n.includes("wic") || n.includes("closet"))
    return ROOM_COLORS.dressing;
  if (n.includes("pooja") || n.includes("puja") || n.includes("prayer") || n.includes("mandir"))
    return ROOM_COLORS.pooja;
  if (n.includes("balcon") || n.includes("terrace") || n.includes("porch") || n.includes("garden") || n.includes("green") || n.includes("lawn"))
    return ROOM_COLORS.outdoor;
  if (n.includes("lobby") || n.includes("foyer") || n.includes("entry") || n.includes("stair"))
    return ROOM_COLORS.lobby;
  if (n.includes("study") || n.includes("office") || n.includes("library"))
    return ROOM_COLORS.study;
  if (n.includes("utility") || n.includes("laundry") || n.includes("store") || n.includes("maid"))
    return ROOM_COLORS.utility;

  return ROOM_COLORS.default;
}

// ── SVG overlay builder ────────────────────────────────────────────────────

function buildOverlaySvg(
  imgWidth: number,
  imgHeight: number,
  rooms: RoomDetail[],
  plotInfo?: PlotInfo,
  options?: { showLegend?: boolean; showCompass?: boolean; showLabels?: boolean }
): string {
  const { showLegend = true, showCompass = true, showLabels = true } = options ?? {};

  const roomsWithBox = rooms.filter((r) => r.boundingBox);

  // Room overlays — high opacity fills with label pill backgrounds
  const roomRects = roomsWithBox.map((room) => {
    const box = room.boundingBox!;
    const color = getRoomColor(room.name);

    const x = Math.round(box.x * imgWidth);
    const y = Math.round(box.y * imgHeight);
    const w = Math.round(box.width * imgWidth);
    const h = Math.round(box.height * imgHeight);

    // Scale font size relative to box dimensions
    const minDim = Math.min(w, h);
    const fontSize = Math.max(10, Math.min(16, Math.round(minDim * 0.10)));
    const sizeFont = Math.max(8, fontSize - 2);

    const displayName = w < 100
      ? room.name.replace(/Room/gi, "Rm").replace(/Area/gi, "").replace(/Dressing/gi, "Dress")
      : room.name;
    const sizeLabel = room.sizeEstimateSqm ? `${room.sizeEstimateSqm} m²` : "";

    // Label pill dimensions
    const nameWidth = displayName.length * fontSize * 0.55;
    const sizeWidth = sizeLabel ? sizeLabel.length * sizeFont * 0.6 : 0;
    const pillW = Math.max(nameWidth, sizeWidth) + 16;
    const pillH = sizeLabel ? fontSize + sizeFont + 14 : fontSize + 10;
    const pillX = x + w / 2 - pillW / 2;
    const pillY = y + h / 2 - pillH / 2;

    return `
      <!-- ${room.name} -->
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
        fill="${color.fill}" fill-opacity="0.75"
        stroke="${color.stroke}" stroke-width="2.5" rx="3" />

      ${showLabels ? `
        <!-- Label background pill -->
        <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}"
          fill="white" fill-opacity="0.92" rx="4"
          stroke="${color.stroke}" stroke-width="0.5" stroke-opacity="0.3" />

        <!-- Room name -->
        <text x="${x + w / 2}" y="${pillY + (sizeLabel ? fontSize + 2 : pillH / 2 + 1)}"
          text-anchor="middle" dominant-baseline="middle"
          font-family="Helvetica, Arial, sans-serif"
          font-size="${fontSize}" font-weight="700" fill="#1a1917"
          letter-spacing="0.03em">
          ${escapeXml(displayName)}
        </text>

        ${sizeLabel ? `
          <!-- Area -->
          <text x="${x + w / 2}" y="${pillY + fontSize + sizeFont + 6}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="Helvetica, Arial, sans-serif"
            font-size="${sizeFont}" fill="#6B7280">
            ${sizeLabel}
          </text>
        ` : ""}
      ` : ""}
    `;
  }).join("\n");

  // Compass rose — larger, clearer
  const compass = showCompass && plotInfo?.facing ? (() => {
    const cx = imgWidth - 60;
    const cy = 60;
    const r = 32;
    const facingDeg: Record<string, number> = {
      north: 0, "north-east": 45, east: 90, "south-east": 135,
      south: 180, "south-west": 225, west: 270, "north-west": 315,
    };
    const rotation = facingDeg[(plotInfo.facing ?? "").toLowerCase()] ?? 0;

    return `
      <g transform="translate(${cx}, ${cy})">
        <circle r="${r + 8}" fill="white" fill-opacity="0.95"
          stroke="#D1D5DB" stroke-width="1.5" />
        <g transform="rotate(${rotation})">
          <polygon points="0,${-r} -7,4 7,4" fill="#1F2937" />
          <polygon points="0,${r} -7,-4 7,-4" fill="#D1D5DB" />
          <line x1="${-r + 10}" y1="0" x2="${r - 10}" y2="0"
            stroke="#E5E7EB" stroke-width="1.5" />
        </g>
        <text x="0" y="${-r - 6}" text-anchor="middle"
          font-family="Helvetica, Arial, sans-serif"
          font-size="9" font-weight="700" fill="#374151"
          letter-spacing="0.2em">N</text>
        <text x="0" y="${r + 14}" text-anchor="middle"
          font-family="Helvetica, Arial, sans-serif"
          font-size="7" fill="#9CA3AF"
          letter-spacing="0.1em">${escapeXml((plotInfo.facing ?? "").toUpperCase())}</text>
      </g>
    `;
  })() : "";

  // Legend strip — solid white bar at bottom with clear swatches
  const legend = showLegend ? (() => {
    const legendItems: { color: RoomColor; label: string }[] = [];
    const seen = new Set<string>();
    for (const room of roomsWithBox) {
      const color = getRoomColor(room.name);
      if (!seen.has(color.label)) {
        seen.add(color.label);
        legendItems.push({ color, label: color.label });
      }
    }

    const legendHeight = 40;
    const legendY = imgHeight - legendHeight;
    const totalItemsWidth = legendItems.length * 95;
    const startX = Math.max(16, (imgWidth - totalItemsWidth) / 2);

    const items = legendItems.map((item, i) => {
      const ix = startX + i * 95;
      return `
        <rect x="${ix}" y="${legendY + 14}" width="14" height="14" rx="3"
          fill="${item.color.fill}" stroke="${item.color.stroke}" stroke-width="1.5" />
        <text x="${ix + 20}" y="${legendY + 24}"
          font-family="Helvetica, Arial, sans-serif"
          font-size="9" fill="#374151" font-weight="500"
          letter-spacing="0.05em">${item.label}</text>
      `;
    }).join("\n");

    return `
      <rect x="0" y="${legendY}" width="${imgWidth}" height="${legendHeight}"
        fill="white" fill-opacity="0.95" />
      <line x1="0" y1="${legendY}" x2="${imgWidth}" y2="${legendY}"
        stroke="#E5E7EB" stroke-width="1" />
      ${items}
    `;
  })() : "";

  return `<svg xmlns="http://www.w3.org/2000/svg"
    width="${imgWidth}" height="${imgHeight}"
    viewBox="0 0 ${imgWidth} ${imgHeight}">
    ${roomRects}
    ${compass}
    ${legend}
  </svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ── Main renderer ──────────────────────────────────────────────────────────

/**
 * Render a color-coded floor plan by compositing an SVG overlay onto
 * the original plan image.
 *
 * @returns PNG buffer of the rendered plan
 */
export async function renderColorCodedPlan(
  planImagePath: string,
  rooms: RoomDetail[],
  plotInfo?: PlotInfo,
  options?: { showLegend?: boolean; showCompass?: boolean; showLabels?: boolean }
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

  // Get image dimensions
  const metadata = await sharp(inputBuffer).metadata();
  const imgWidth = metadata.width ?? 1200;
  const imgHeight = metadata.height ?? 800;

  // Build the SVG overlay
  const svgOverlay = buildOverlaySvg(imgWidth, imgHeight, rooms, plotInfo, options);
  const svgBuffer = Buffer.from(svgOverlay);

  // Composite: original plan + SVG overlay
  const result = await sharp(inputBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();

  console.log(`[planRenderer] Rendered color-coded plan: ${(result.length / 1024).toFixed(0)}KB, ${imgWidth}×${imgHeight}, ${rooms.filter(r => r.boundingBox).length} rooms overlaid`);

  return result;
}

/**
 * Render and save the color-coded plan to disk/blob, returning the URL.
 */
export async function renderAndSavePlan(
  planImagePath: string,
  projectId: string,
  rooms: RoomDetail[],
  plotInfo?: PlotInfo,
  options?: { showLegend?: boolean; showCompass?: boolean; showLabels?: boolean }
): Promise<string> {
  const { saveUploadedFile } = await import("@/lib/store");

  const buffer = await renderColorCodedPlan(planImagePath, rooms, plotInfo, options);
  const filename = `plan-${projectId}-rendered.png`;
  const { url } = await saveUploadedFile(buffer, filename);

  return url;
}
