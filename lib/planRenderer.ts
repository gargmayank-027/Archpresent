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
  // Bedrooms
  bedroom:    { fill: "#DBEAFE", stroke: "#93C5FD", label: "Bedrooms" },
  // Living / Drawing
  living:     { fill: "#D1FAE5", stroke: "#6EE7B7", label: "Living" },
  // Kitchen
  kitchen:    { fill: "#FEF3C7", stroke: "#FCD34D", label: "Kitchen" },
  // Dining
  dining:     { fill: "#FFE4E6", stroke: "#FDA4AF", label: "Dining" },
  // Bathroom / Toilet
  bathroom:   { fill: "#E5E7EB", stroke: "#9CA3AF", label: "Bath" },
  // Dressing / Wardrobe
  dressing:   { fill: "#EDE9FE", stroke: "#C4B5FD", label: "Dressing" },
  // Pooja / Prayer
  pooja:      { fill: "#FEF0CD", stroke: "#F6C547", label: "Pooja" },
  // Balcony / Outdoor
  outdoor:    { fill: "#D1FAE5", stroke: "#34D399", label: "Outdoor" },
  // Lobby / Entry
  lobby:      { fill: "#FEF9C3", stroke: "#FDE047", label: "Lobby" },
  // Study / Office
  study:      { fill: "#DBEAFE", stroke: "#60A5FA", label: "Study" },
  // Utility
  utility:    { fill: "#F3F4F6", stroke: "#D1D5DB", label: "Utility" },
  // Default
  default:    { fill: "#F9FAFB", stroke: "#E5E7EB", label: "Other" },
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
  const usedColorKeys = new Set<string>();

  // Room overlays
  const roomRects = roomsWithBox.map((room) => {
    const box = room.boundingBox!;
    const color = getRoomColor(room.name);
    usedColorKeys.add(room.name);

    const x = Math.round(box.x * imgWidth);
    const y = Math.round(box.y * imgHeight);
    const w = Math.round(box.width * imgWidth);
    const h = Math.round(box.height * imgHeight);

    // Scale font size relative to box size — smaller rooms get smaller text
    const fontSize = Math.max(9, Math.min(14, Math.round(Math.min(w, h) * 0.09)));
    const sizeFont = Math.max(7, fontSize - 2);
    const labelY = y + h / 2;

    // Shorten display name for small boxes
    const displayName = w < 80 ? room.name.replace(/Room/gi, "Rm").replace(/Area/gi, "") : room.name;
    const sizeLabel = room.sizeEstimateSqm ? `${room.sizeEstimateSqm} m²` : "";

    return `
      <!-- ${room.name} -->
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
        fill="${color.fill}" fill-opacity="0.55"
        stroke="${color.stroke}" stroke-width="1.5" rx="2" />
      ${showLabels ? `
        <text x="${x + w / 2}" y="${labelY - (sizeLabel ? 4 : 0)}"
          text-anchor="middle" dominant-baseline="middle"
          font-family="'Instrument Sans', system-ui, sans-serif"
          font-size="${fontSize}" font-weight="600" fill="#1F2937"
          letter-spacing="0.02em">
          ${escapeXml(displayName)}
        </text>
        ${sizeLabel ? `
          <text x="${x + w / 2}" y="${labelY + fontSize - 1}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="'DM Mono', monospace"
            font-size="${sizeFont}" fill="#6B7280">
            ${sizeLabel}
          </text>
        ` : ""}
      ` : ""}
    `;
  }).join("\n");

  // Compass rose (top-right corner)
  const compass = showCompass && plotInfo?.facing ? (() => {
    const cx = imgWidth - 50;
    const cy = 50;
    const r = 28;
    // Rotate based on facing — "East" means the plot faces East
    const facingDeg: Record<string, number> = {
      north: 0, "north-east": 45, east: 90, "south-east": 135,
      south: 180, "south-west": 225, west: 270, "north-west": 315,
    };
    const rotation = facingDeg[(plotInfo.facing ?? "").toLowerCase()] ?? 0;

    return `
      <g transform="translate(${cx}, ${cy})">
        <circle r="${r + 6}" fill="white" fill-opacity="0.85" stroke="#E5E7EB" stroke-width="1" />
        <g transform="rotate(${rotation})">
          <!-- North pointer -->
          <polygon points="0,${-r} -6,6 6,6" fill="#1F2937" />
          <!-- South pointer -->
          <polygon points="0,${r} -6,-6 6,-6" fill="#D1D5DB" />
          <!-- East/West lines -->
          <line x1="${-r + 8}" y1="0" x2="${r - 8}" y2="0" stroke="#D1D5DB" stroke-width="1" />
        </g>
        <text x="0" y="${-r - 4}" text-anchor="middle"
          font-family="'DM Mono', monospace" font-size="7" fill="#6B7280"
          letter-spacing="0.15em">N</text>
      </g>
    `;
  })() : "";

  // Legend strip at bottom
  const legend = showLegend ? (() => {
    // Collect unique room type colors used
    const legendItems: { color: RoomColor; label: string }[] = [];
    const seen = new Set<string>();
    for (const room of roomsWithBox) {
      const color = getRoomColor(room.name);
      if (!seen.has(color.label)) {
        seen.add(color.label);
        legendItems.push({ color, label: color.label });
      }
    }

    const legendHeight = 32;
    const legendY = imgHeight - legendHeight;
    const itemWidth = Math.min(100, (imgWidth - 40) / legendItems.length);

    const items = legendItems.map((item, i) => {
      const ix = 20 + i * itemWidth;
      return `
        <rect x="${ix}" y="${legendY + 10}" width="12" height="12" rx="2"
          fill="${item.color.fill}" stroke="${item.color.stroke}" stroke-width="1" />
        <text x="${ix + 18}" y="${legendY + 19}"
          font-family="'DM Mono', monospace" font-size="8" fill="#6B7280"
          letter-spacing="0.1em">${item.label}</text>
      `;
    }).join("\n");

    return `
      <rect x="0" y="${legendY}" width="${imgWidth}" height="${legendHeight}"
        fill="white" fill-opacity="0.9" />
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
