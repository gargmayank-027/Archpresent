/**
 * lib/pdf.ts
 *
 * 16:9 widescreen PDF deck — 1190 × 669 pt (close to 16:9 at 72 dpi).
 * Designed like a keynote/PowerPoint presentation slide, not a document.
 *
 * Pages:
 *   1. Cover         — full-bleed split layout, logo, project name
 *   2. Site Context  — two-column data + compass rose
 *   3. Floor Plan    — full-bleed plan on dark background
 *   4. Plan Strengths — two-column numbered bullets
 *   5+. Moodboard    — full-bleed image + room label overlay
 */

import {
  PDFDocument,
  rgb,
  RGB,
  StandardFonts,
  PDFFont,
  PDFPage,
  PDFImage,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
} from "pdf-lib";
import fs from "fs";
import https from "https";
import http from "http";
import type { Project, Moodboard, FirmProfile, PdfAccentColor, RoomMoodboard, OverallMoodboard } from "@/types";
import { firmStore } from "@/lib/store";

// ─── 16:9 slide dimensions (pt) ──────────────────────────────────────────────
const W  = 1190;   // 16 units
const H  = 669;    // ~9 units  (1190/16*9 = 669.375)
const M  = 56;     // margin
const FOOTER_H = 38; // vertical space reserved at bottom for the footer band; no slide content may enter this zone

// ─── Accent colors ────────────────────────────────────────────────────────────
const ACCENT_COLORS: Record<PdfAccentColor, RGB> = {
  graphite:   rgb(0.176, 0.169, 0.153),
  navy:       rgb(0.102, 0.153, 0.267),
  forest:     rgb(0.102, 0.227, 0.165),
  terracotta: rgb(0.545, 0.227, 0.118),
  slate:      rgb(0.165, 0.208, 0.251),
  plum:       rgb(0.227, 0.102, 0.267),
};

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  bg:      rgb(0.97, 0.96, 0.94),   // warm off-white
  bgDark:  rgb(0.12, 0.11, 0.10),   // near-black for full-bleed slides
  ink:     rgb(0.10, 0.10, 0.10),
  muted:   rgb(0.50, 0.50, 0.47),
  light:   rgb(0.85, 0.84, 0.82),   // light text on dark bg
  rule:    rgb(0.80, 0.78, 0.74),
  altRow:  rgb(0.93, 0.92, 0.90),
  white:   rgb(1, 1, 1),
};

// ─── Main export ──────────────────────────────────────────────────────────────

export async function buildProjectPdf(project: Project): Promise<Buffer> {
  const firm   = await firmStore.get();
  const accent = ACCENT_COLORS[firm?.accentColor ?? "graphite"];

  const doc    = await PDFDocument.create();
  const reg    = await doc.embedFont(StandardFonts.Helvetica);
  const bold   = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Embed logo
  let logoBytes: Uint8Array | null = null;
  let logoIsPng = false;
  // logoDiskPath is a disk path locally, a blob URL on Vercel
  const logoPath = firm?.logoDiskPath ?? firm?.logoUrl;
  if (logoPath) {
    try {
      const ext = logoPath.split(".").pop()?.toLowerCase() ?? "";
      if (["png","jpg","jpeg","webp"].includes(ext)) {
        const buf = await loadImageBytes(logoPath);
        if (buf) {
          logoBytes = buf;
          logoIsPng = ext === "png";
        }
      }
    } catch { /* logo failed — skip gracefully */ }
  }

  // Build pages
  await addCoverSlide(doc, project, firm, accent, reg, bold, italic, logoBytes, logoIsPng);

  if (project.plotInfo && Object.keys(project.plotInfo).length > 0) {
    await addSiteContextSlide(doc, project, accent, reg, bold);
  }

  await addPlanSlide(doc, project, accent, reg, bold);

  if ((project.planStrengths ?? []).length > 0) {
    await addStrengthsSlide(doc, project, project.planStrengths!, accent, reg, bold);
  }

  // Overall style moodboard slide (4-image collage)
  if (project.overallMoodboard) {
    await addOverallMoodboardSlide(doc, project.overallMoodboard, project, accent, reg, bold, italic);
  }

  // Per-room slides: plan snippet left + 3-4 mood images right
  if (project.roomMoodboards && project.roomMoodboards.length > 0) {
    for (const rm of project.roomMoodboards) {
      await addRoomMoodboardSlide(doc, rm, project, accent, reg, bold);
    }
  } else {
    // Legacy fallback
    for (const mb of project.moodboards ?? []) {
      await addMoodboardSlide(doc, mb, accent, reg, bold);
    }
  }

  // Footer on all pages
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    addSlideFooter(pages[i], reg, bold, i + 1, pages.length, firm, accent);
  }

  return Buffer.from(await doc.save());
}

// ─── 1. Cover slide ───────────────────────────────────────────────────────────
// Layout: left half = accent color block, right half = off-white with text

async function addCoverSlide(
  doc: PDFDocument,
  project: Project,
  firm: FirmProfile | null,
  accent: RGB,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont,
  logoBytes: Uint8Array | null,
  logoIsPng: boolean,
) {
  const page = doc.addPage([W, H]);

  // Left accent panel — 42% of width
  const splitX = Math.round(W * 0.42);
  page.drawRectangle({ x: 0, y: 0, width: splitX, height: H, color: accent });

  // Right panel — warm off-white
  page.drawRectangle({ x: splitX, y: 0, width: W - splitX, height: H, color: C.bg });

  // ── Left panel content ─────────────────────────────────────────────────
  // "CONCEPT PRESENTATION" — small label top
  page.drawText("CONCEPT PRESENTATION", {
    x: M, y: H - M,
    size: 8, font, color: rgb(1,1,1), opacity: 0.5,
  });

  // Project name — large, white
  const projLines = wrapText(project.name.toUpperCase(), bold, 38, splitX - M * 2);
  let projY = H * 0.58;
  for (const line of projLines) {
    page.drawText(line, { x: M, y: projY, size: 38, font: bold, color: C.white });
    projY -= 46;
  }

  // Thin rule
  page.drawLine({
    start: { x: M, y: projY - 8 },
    end:   { x: splitX - M, y: projY - 8 },
    thickness: 0.6, color: rgb(1,1,1), opacity: 0.3,
  });

  // Client name
  page.drawText(`Prepared for`, {
    x: M, y: projY - 28, size: 9, font, color: rgb(1,1,1), opacity: 0.55,
  });
  page.drawText(project.clientName, {
    x: M, y: projY - 44, size: 14, font: italic, color: C.white, opacity: 0.9,
  });

  // Date — bottom left of panel, clear of the global footer band
  const dateStr = new Date(project.createdAt).toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });
  page.drawText(dateStr, { x: M, y: M + FOOTER_H + 14, size: 8, font, color: rgb(1,1,1), opacity: 0.45 });

  // ── Right panel content ─────────────────────────────────────────────────
  const rx = splitX + M;  // right content x-origin

  // Logo — top right
  if (logoBytes) {
    try {
      const img  = logoIsPng ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes);
      const dims = img.scaleToFit(130, 48);
      page.drawImage(img, {
        x: W - M - dims.width, y: H - M - dims.height,
        width: dims.width, height: dims.height, opacity: 0.8,
      });
    } catch { /* fallback to text */ }
  }

  // Firm name
  const firmName = (firm?.name ?? project.firmName).toUpperCase();
  const fnW = bold.widthOfTextAtSize(firmName, 9);
  page.drawText(firmName, {
    x: W - M - fnW, y: logoBytes ? H - M - 56 : H - M,
    size: 9, font: bold, color: C.muted,
  });

  // Cover tagline — large editorial text
  if (firm?.coverTagline) {
    const tagLines = wrapText(firm.coverTagline, italic, 22, W - splitX - M * 2);
    let ty = H * 0.60;
    for (const line of tagLines) {
      page.drawText(line, { x: rx, y: ty, size: 22, font: italic, color: C.ink, opacity: 0.7 });
      ty -= 28;
    }
  }

  // Plot tag line — middle right
  const plotParts: string[] = [];
  if (project.plotInfo?.numberOfBedrooms) plotParts.push(`${project.plotInfo.numberOfBedrooms} BHK`);
  if (project.plotInfo?.propertyType)     plotParts.push(project.plotInfo.propertyType);
  if (project.plotInfo?.facing)           plotParts.push(`${project.plotInfo.facing}-facing`);
  if (project.plotInfo?.builtUpAreaSqm)   plotParts.push(`${project.plotInfo.builtUpAreaSqm} sqm`);
  else if (project.plotInfo?.plotAreaSqm) plotParts.push(`${project.plotInfo.plotAreaSqm} sqm`);

  if (plotParts.length > 0) {
    const plotY = firm?.coverTagline ? H * 0.35 : H * 0.50;
    page.drawText(plotParts.join("  ·  "), {
      x: rx, y: plotY, size: 10, font, color: C.muted,
    });
  }

  // Firm tagline — lower right, clear of the global footer band
  if (firm?.tagline) {
    page.drawText(firm.tagline, { x: rx, y: M + FOOTER_H + 14, size: 10, font, color: C.muted });
  }
}

// ─── 2. Site context slide ────────────────────────────────────────────────────
// Two-column table on left, compass rose on right

async function addSiteContextSlide(
  doc: PDFDocument,
  project: Project,
  accent: RGB,
  font: PDFFont,
  bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bg });

  // Top accent bar
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  slideTitle(page, "SITE CONTEXT", font, bold, accent);

  const p = project.plotInfo!;
  const rows: { label: string; value: string }[] = [];
  if (p.propertyType)      rows.push({ label: "Property Type",      value: p.propertyType });
  if (p.numberOfBedrooms)  rows.push({ label: "Configuration",      value: `${p.numberOfBedrooms} BHK` });
  if (p.builtUpAreaSqm)    rows.push({ label: "Built-up Area",      value: `${p.builtUpAreaSqm} sqm` });
  if (p.plotAreaSqm)       rows.push({ label: "Plot / Carpet Area", value: `${p.plotAreaSqm} sqm` });
  if (p.facing)            rows.push({ label: "Plot Facing",        value: p.facing });
  if (p.floorLocation)     rows.push({ label: "Floor Location",     value: `${p.floorLocation} floor` });
  if (p.numberOfFloors)    rows.push({ label: "Floors in Building", value: String(p.numberOfFloors) });
  if (p.vaastuCompliance)  rows.push({ label: "Vaastu",             value: "Compliance required" });

  // Two-column table — left half of slide
  const tableW = W * 0.55;
  const rowH   = Math.min(44, (H - 160) / Math.max(rows.length, 1));
  let ty       = H - 120;

  for (const [i, row] of rows.entries()) {
    if (i % 2 === 0) {
      page.drawRectangle({ x: M, y: ty - 8, width: tableW - M, height: rowH, color: C.altRow });
    }
    page.drawText(row.label.toUpperCase(), {
      x: M + 10, y: ty + 8, size: 8, font: bold, color: C.muted,
    });
    page.drawText(row.value, {
      x: M + 200, y: ty + 8, size: 13, font, color: C.ink,
    });
    ty -= rowH;
  }

  if (p.additionalNotes) {
    ty -= 10;
    page.drawText("NOTES", { x: M, y: ty, size: 8, font: bold, color: C.muted });
    ty -= 16;
    for (const line of wrapText(p.additionalNotes, font, 11, tableW - M * 2)) {
      page.drawText(line, { x: M, y: ty, size: 11, font, color: C.ink });
      ty -= 15;
    }
  }

  // Compass rose — right side, sized to fill its dedicated panel
  if (p.facing) {
    const cx = W * 0.785;
    const cy = H * 0.52;
    const r  = 108; // enlarged from 80 — fills the panel with real presence

    // Soft filled dial behind the ring
    page.drawCircle({ x: cx, y: cy, size: r + 4, color: C.altRow });
    page.drawCircle({ x: cx, y: cy, size: r, borderColor: C.rule, borderWidth: 1.5, color: C.white });

    // Tick marks at 8 compass points
    for (let deg = 0; deg < 360; deg += 45) {
      const rad2 = (deg * Math.PI) / 180;
      const isCardinal = deg % 90 === 0;
      const innerR = isCardinal ? r - 12 : r - 7;
      page.drawLine({
        start: { x: cx + Math.cos(rad2) * innerR, y: cy + Math.sin(rad2) * innerR },
        end:   { x: cx + Math.cos(rad2) * r,      y: cy + Math.sin(rad2) * r },
        thickness: isCardinal ? 1.2 : 0.6, color: C.muted,
      });
    }

    page.drawCircle({ x: cx, y: cy, size: 5, color: accent });

    const cardinals = [
      { l: "N", dx: 0, dy: r + 18 }, { l: "S", dx: 0, dy: -r - 28 },
      { l: "E", dx: r + 14, dy: -5 }, { l: "W", dx: -r - 28, dy: -5 },
    ];
    for (const c of cardinals) {
      const active = p.facing!.startsWith(c.l);
      page.drawText(c.l, {
        x: cx + c.dx - 5, y: cy + c.dy,
        size: 14, font: active ? bold : font,
        color: active ? accent : C.muted,
      });
    }

    const angles: Record<string, number> = {
      North: 90, South: 270, East: 0, West: 180,
      "North-East": 45, "North-West": 135, "South-East": 315, "South-West": 225,
    };
    const rad = ((angles[p.facing] ?? 90) * Math.PI) / 180;
    const tipX = cx + Math.cos(rad) * (r - 10);
    const tipY = cy + Math.sin(rad) * (r - 10);

    page.drawLine({
      start: { x: cx, y: cy }, end: { x: tipX, y: tipY },
      thickness: 3.5, color: accent,
    });

    // Arrowhead at the pointer tip — two short lines rather than an SVG
    // path (pdf-lib's drawSvgPath can render multi-segment paths
    // unreliably; plain drawLine is guaranteed to work).
    const headLen = 11, headAngle = 0.5;
    const back1 = { x: tipX - headLen * Math.cos(rad - headAngle), y: tipY - headLen * Math.sin(rad - headAngle) };
    const back2 = { x: tipX - headLen * Math.cos(rad + headAngle), y: tipY - headLen * Math.sin(rad + headAngle) };
    page.drawLine({ start: { x: tipX, y: tipY }, end: back1, thickness: 3.5, color: accent });
    page.drawLine({ start: { x: tipX, y: tipY }, end: back2, thickness: 3.5, color: accent });

    // Label below compass
    page.drawText(`${p.facing} facing`, {
      x: cx - bold.widthOfTextAtSize(`${p.facing} facing`, 9) / 2,
      y: cy - r - 36, size: 9, font: bold, color: C.muted,
    });
  }
}

// ─── 3. Floor plan slide ──────────────────────────────────────────────────────
// Dark background, plan centered, room list on right side

async function addPlanSlide(
  doc: PDFDocument, project: Project, accent: RGB, font: PDFFont, bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bgDark });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  // Title — top left, on dark bg
  page.drawText("FLOOR PLAN", {
    x: M, y: H - M - 4, size: 9, font: bold, color: accent,
  });

  // Plan image — left 70% of slide
  const planW = W * 0.68;
  const planH = H - 80;

  try {
    const imgBytes = await loadImageBytes(project.planImagePath);
    if (!imgBytes) throw new Error("Could not load plan image");
    const ext      = project.planImagePath.split(".").pop()?.toLowerCase();
    const pdfImg   = ext === "png" ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
    const dims     = pdfImg.scaleToFit(planW - M * 2, planH - 20);
    const ix       = M + (planW - M * 2 - dims.width) / 2;
    const iy       = (planH - dims.height) / 2 + 20;
    page.drawImage(pdfImg, { x: ix, y: iy, width: dims.width, height: dims.height });
  } catch {
    page.drawRectangle({ x: M, y: 40, width: planW - M * 2, height: planH - 20,
      color: rgb(0.2, 0.2, 0.2) });
    page.drawText("[Floor Plan]", { x: planW / 2 - 40, y: H / 2, size: 12, font, color: C.muted });
  }

  // Room list — right panel
  const rx     = planW + 16;
  const rooms  = project.analysis?.rooms ?? [];
  const rW     = W - planW - M - 16;

  page.drawText("ROOMS", { x: rx, y: H - M - 4, size: 8, font: bold, color: C.muted });
  page.drawLine({
    start: { x: rx, y: H - M - 14 }, end: { x: rx + rW - 10, y: H - M - 14 },
    thickness: 0.4, color: rgb(0.3, 0.3, 0.3),
  });

  const maxRooms  = Math.min(rooms.length, 10);
  const itemH     = Math.min(36, (H - 120) / Math.max(maxRooms, 1));
  let roomY       = H - M - 28;

  for (let i = 0; i < maxRooms; i++) {
    const room = rooms[i];
    page.drawText(room.name, { x: rx, y: roomY, size: 10, font, color: C.light });
    if (room.sizeEstimateSqm) {
      const sqmStr = `${room.sizeEstimateSqm} m²`;
      const sqmW   = font.widthOfTextAtSize(sqmStr, 9);
      page.drawText(sqmStr, { x: rx + rW - sqmW - 10, y: roomY, size: 9, font, color: C.muted });
    }
    page.drawLine({
      start: { x: rx, y: roomY - 8 }, end: { x: rx + rW - 10, y: roomY - 8 },
      thickness: 0.3, color: rgb(0.25, 0.25, 0.25),
    });
    roomY -= itemH;
  }

  if (project.analysis?.totalAreaSqm) {
    page.drawText(`Total  ·  ${project.analysis.totalAreaSqm} m²`, {
      x: rx, y: M + 20, size: 9, font: bold, color: accent,
    });
  }
}

// ─── 4. Plan strengths slide ──────────────────────────────────────────────────
// Two-column grid of numbered bullets

async function addStrengthsSlide(
  doc: PDFDocument, project: Project, strengths: string[],
  accent: RGB, font: PDFFont, bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bg });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  slideTitle(page, "PLAN STRENGTHS", font, bold, accent);

  page.drawText(`What makes ${project.name} work for you`, {
    x: M, y: H - 90, size: 11, font, color: C.muted,
  });

  // Two-column layout
  const colW     = (W - M * 2 - 32) / 2;
  const maxItems = Math.min(strengths.length, 6);
  const col1     = strengths.slice(0, Math.ceil(maxItems / 2));
  const col2     = strengths.slice(Math.ceil(maxItems / 2), maxItems);

  function drawBullets(bullets: string[], xStart: number, startNum: number) {
    let y = H - 130;
    for (const [i, text] of bullets.entries()) {
      // Number — continuous across both columns, not reset per column
      page.drawText(String(startNum + i).padStart(2, "0"), {
        x: xStart, y, size: 20, font: bold, color: C.rule,
      });
      // Text — wrapped
      const lines = wrapText(text, font, 11, colW - 44);
      let lineY = y + 3;
      for (const line of lines) {
        page.drawText(line, { x: xStart + 44, y: lineY, size: 11, font, color: C.ink });
        lineY -= 15;
      }
      // Rule
      const blockH = Math.max(38, lines.length * 15 + 16);
      page.drawLine({
        start: { x: xStart, y: y - blockH + 18 },
        end:   { x: xStart + colW, y: y - blockH + 18 },
        thickness: 0.4, color: C.rule,
      });
      y -= blockH + 10;
    }
  }

  drawBullets(col1, M, 1);
  drawBullets(col2, M + colW + 32, col1.length + 1);

  // Room tags — sit clear of the global footer band
  const roomTags = (project.analysis?.rooms ?? []).map((r) => r.name).join("  ·  ");
  if (roomTags) {
    page.drawText(roomTags, { x: M, y: M + FOOTER_H + 14, size: 8, font, color: C.muted });
  }
}

// ─── 5. Moodboard slide ───────────────────────────────────────────────────────
// Full-bleed image, dark gradient overlay, room name + notes at bottom

async function addMoodboardSlide(
  doc: PDFDocument, mb: Moodboard, accent: RGB, font: PDFFont, bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bgDark });

  // Full-bleed image
  try {
    const imgBytes = await loadImageBytes(mb.imageUrl);
    if (!imgBytes) throw new Error("Could not load moodboard image");
    const pdfImg = await doc.embedJpg(imgBytes).catch(() => doc.embedPng(imgBytes));

    // Scale to fill slide (crop if needed — use the larger scale factor)
    const scaleX = W / pdfImg.width;
    const scaleY = H / pdfImg.height;
    const scale  = Math.max(scaleX, scaleY);
    const iw     = pdfImg.width  * scale;
    const ih     = pdfImg.height * scale;
    const ix     = (W - iw) / 2;
    const iy     = (H - ih) / 2;

    page.drawImage(pdfImg, { x: ix, y: iy, width: iw, height: ih });
  } catch {
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.15, 0.15, 0.15) });
  }

  // Dark gradient overlay at bottom — drawn as a semi-transparent rectangle
  page.drawRectangle({
    x: 0, y: 0, width: W, height: 130,
    color: rgb(0, 0, 0), opacity: 0.72,
  });

  // Top accent bar
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  // Room label — bottom left
  page.drawText(mb.roomName.toUpperCase(), {
    x: M, y: 72, size: 26, font: bold, color: C.white,
  });

  // Thin rule above label
  page.drawLine({
    start: { x: M, y: 100 }, end: { x: M + 200, y: 100 },
    thickness: 1, color: accent,
  });

  // "Interior Concept" label — bottom right
  page.drawText("Interior Concept  ·  AI-Generated Reference", {
    x: W - M - bold.widthOfTextAtSize("Interior Concept  ·  AI-Generated Reference", 8),
    y: 20, size: 8, font, color: rgb(1,1,1), opacity: 0.35,
  });
}

// ─── 6. Overall style moodboard slide ────────────────────────────────────────
// 2×2 grid of hero images + style statement

async function addOverallMoodboardSlide(
  doc: PDFDocument,
  overall: OverallMoodboard,
  project: Project,
  accent: RGB,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bgDark });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  // Title bar
  page.drawText("INTERIOR STYLE  ·  OVERALL CONCEPT", {
    x: M, y: H - M - 4, size: 9, font: bold, color: accent,
  });

  // Style name + statement
  const styleName = project.styleProfile?.overallStyle ?? "Modern";
  page.drawText(styleName.toUpperCase(), {
    x: M, y: H - M - 22, size: 20, font: bold, color: C.white,
  });
  page.drawText(`"${overall.styleStatement}"`, {
    x: M, y: H - M - 40, size: 10, font: italic, color: C.light, opacity: 0.7,
  });

  // 2×2 image grid — right 60% of slide, top to bottom
  const gridLeft  = W * 0.42;
  const gridRight = W - 16;
  const gridTop   = H - 16;
  const gridBot   = M + FOOTER_H + 44; // clear of palette tags + footer band
  const gW  = (gridRight - gridLeft - 8) / 2;
  const gH  = (gridTop - gridBot - 8) / 2;

  const positions = [
    { x: gridLeft,        y: gridTop - gH },
    { x: gridLeft + gW + 8, y: gridTop - gH },
    { x: gridLeft,        y: gridBot },
    { x: gridLeft + gW + 8, y: gridBot },
  ];

  for (let i = 0; i < Math.min(4, overall.images.length); i++) {
    const img   = overall.images[i];
    const pos   = positions[i];
    try {
      const buf  = await fetchRemoteImageSafe(img.url);
      if (!buf) continue;
      const pImg = await embedImageSafe(doc, buf);
      if (!pImg) continue;

      // Cover-crop into the cell — preserves aspect ratio, fills exactly,
      // no stretching/distortion (previous version stretched to gW×gH).
      const scale = Math.max(gW / pImg.width, gH / pImg.height);
      const dw    = pImg.width  * scale;
      const dh    = pImg.height * scale;
      const dx    = pos.x - (dw - gW) / 2;
      const dy    = pos.y - (dh - gH) / 2;

      drawClippedImage(page, pImg, { x: dx, y: dy, width: dw, height: dh },
        { x: pos.x, y: pos.y, width: gW, height: gH });

      // Caption overlay
      page.drawRectangle({ x: pos.x, y: pos.y, width: gW, height: 22, color: rgb(0,0,0), opacity: 0.55 });
      page.drawText((img.caption ?? "").toUpperCase(), {
        x: pos.x + 8, y: pos.y + 7, size: 7, font, color: C.white, opacity: 0.8,
      });
    } catch { /* skip */ }
  }

  // Palette tags — clear of the global footer band
  const tags = [
    project.styleProfile?.overallStyle,
    project.styleProfile?.palette?.replace(/([A-Z])/g, " $1").trim(),
    project.styleProfile?.budgetVibe,
  ].filter(Boolean) as string[];

  const tagY = M + FOOTER_H + 16;
  let tx = M;
  for (const tag of tags) {
    page.drawRectangle({ x: tx, y: tagY, width: font.widthOfTextAtSize(tag, 8) + 16, height: 18,
      borderColor: accent, borderWidth: 0.5 });
    page.drawText(tag.toUpperCase(), { x: tx + 8, y: tagY + 6, size: 8, font, color: C.light });
    tx += font.widthOfTextAtSize(tag, 8) + 28;
  }
}

// ─── 7. Per-room moodboard slide ──────────────────────────────────────────────
// Left: plan snippet + room info. Right: 3-image grid + 4th wide strip.

async function addRoomMoodboardSlide(
  doc: PDFDocument,
  rm: RoomMoodboard,
  project: Project,
  accent: RGB,
  font: PDFFont,
  bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bg });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  // Room title
  page.drawRectangle({ x: M, y: H - M - 10, width: 4, height: 14, color: accent });
  page.drawText(rm.roomName.toUpperCase(), {
    x: M + 12, y: H - M - 5, size: 12, font: bold, color: C.ink,
  });
  page.drawLine({
    start: { x: M, y: H - M - 22 },
    end:   { x: W - M, y: H - M - 22 },
    thickness: 0.5, color: C.rule,
  });

  // ── Left panel: plan snippet ─────────────────────────────────────────────
  const leftW    = W * 0.28;
  const planBotY = M + FOOTER_H + 38; // top of the features-tag zone, clear of footer
  const planY    = H - M - 120;
  const planH    = planY - planBotY;

  // Room detail info
  const roomDetail = project.analysis?.rooms.find((r) => r.name === rm.roomName);
  if (roomDetail?.sizeEstimateSqm) {
    page.drawText(`${roomDetail.sizeEstimateSqm} sqm`, {
      x: M, y: H - M - 42, size: 11, font: bold, color: C.ink,
    });
  }
  if (roomDetail?.orientation) {
    page.drawText(roomDetail.orientation, {
      x: M, y: H - M - 58, size: 9, font, color: C.muted,
    });
  }
  if (roomDetail?.notes) {
    page.drawText(roomDetail.notes, {
      x: M, y: H - M - 72, size: 8, font, color: C.muted,
    });
  }

  // Plan snippet image — real crop if we have one, otherwise the full plan
  // (honest fallback rather than a placeholder box or a guessed crop)
  if (rm.planSnippetUrl) {
    try {
      const buf = await loadImageBytes(rm.planSnippetUrl);
      if (buf) {
        const pImg = await doc.embedPng(buf).catch(() => doc.embedJpg(buf));
        const dims = pImg.scaleToFit(leftW - M - 8, planH);
        const sx   = M + (leftW - M - 8 - dims.width) / 2;
        const sy   = planBotY + (planH - dims.height) / 2;
        page.drawRectangle({ x: sx - 4, y: sy - 4, width: dims.width + 8, height: dims.height + 8,
          color: C.white, borderColor: C.rule, borderWidth: 0.5 });
        page.drawImage(pImg, { x: sx, y: sy, width: dims.width, height: dims.height });
      }
    } catch { /* skip */ }
  } else {
    try {
      const buf = await loadImageBytes(project.planImageUrl);
      if (!buf) throw new Error("no plan image");
      const pImg = await doc.embedPng(buf).catch(() => doc.embedJpg(buf));
      const dims = pImg.scaleToFit(leftW - M - 8, planH);
      const sx   = M + (leftW - M - 8 - dims.width) / 2;
      const sy   = planBotY + (planH - dims.height) / 2;
      page.drawRectangle({ x: sx - 4, y: sy - 4, width: dims.width + 8, height: dims.height + 8,
        color: C.white, borderColor: C.rule, borderWidth: 0.5 });
      page.drawImage(pImg, { x: sx, y: sy, width: dims.width, height: dims.height });
      page.drawText("Full plan reference", { x: sx, y: sy - 14, size: 6.5, font, color: C.muted });
    } catch {
      page.drawRectangle({ x: M, y: planBotY, width: leftW - M - 8, height: planH,
        color: C.altRow, borderColor: C.rule, borderWidth: 0.5 });
      page.drawText("PLAN", { x: M + 12, y: planBotY + planH / 2, size: 8, font, color: C.muted });
    }
  }

  // Special features tags — sit between the plan box and the footer
  if (roomDetail?.specialFeatures?.length) {
    let fy = M + FOOTER_H + 24;
    for (const feat of roomDetail.specialFeatures.slice(0, 3)) {
      page.drawText(`· ${feat}`, { x: M, y: fy, size: 8, font, color: C.muted });
      fy -= 12;
    }
  }

  // ── Right panel: mood images ─────────────────────────────────────────────
  // Top row (3 images) + a full-bleed strip below, filling the page edge-to-
  // edge with no dead space — strip is cropped to fill (cover), not fitted.
  const rx       = leftW + 16;
  const rW       = W - rx - M;
  const topY     = H - 30;                 // top edge of the image block
  const bottomY  = M + FOOTER_H + 12;       // bottom edge, clear of footer
  const gap      = 6;
  const stripH   = rm.images[3] ? (H - 90) * 0.30 : 0;
  const imgH     = rm.images[3]
    ? (topY - bottomY - stripH - gap)
    : (topY - bottomY);
  const imgW     = (rW - gap * 2) / 3;

  // Top row: 3 images, cover-cropped to fill each cell exactly (no gaps)
  for (let i = 0; i < Math.min(3, rm.images.length); i++) {
    const img = rm.images[i];
    const ix  = rx + i * (imgW + gap);
    try {
      const buf  = await fetchRemoteImageSafe(img.url);
      if (!buf) continue;
      const pImg = await embedImageSafe(doc, buf);
      if (!pImg) continue;

      // Cover-fit: scale to fill the cell, crop overflow via clipping rect
      const scale  = Math.max(imgW / pImg.width, imgH / pImg.height);
      const dw     = pImg.width  * scale;
      const dh     = pImg.height * scale;
      const dx     = ix - (dw - imgW) / 2;
      const dy     = (topY - imgH) - (dh - imgH) / 2;

      page.drawRectangle({ x: ix, y: topY - imgH, width: imgW, height: imgH, color: C.altRow });
      drawClippedImage(page, pImg, { x: dx, y: dy, width: dw, height: dh },
        { x: ix, y: topY - imgH, width: imgW, height: imgH });

      // Caption
      page.drawRectangle({ x: ix, y: topY - imgH, width: imgW, height: 18,
        color: rgb(0,0,0), opacity: 0.5 });
      page.drawText((img.caption ?? "").toUpperCase(), {
        x: ix + 6, y: topY - imgH + 5, size: 7, font, color: C.white, opacity: 0.85,
      });
    } catch { /* skip */ }
  }

  // 4th image: full-width strip filling all remaining vertical space, cover-cropped
  if (rm.images[3]) {
    const img = rm.images[3];
    try {
      const buf  = await fetchRemoteImageSafe(img.url);
      if (buf) {
        const pImg = await embedImageSafe(doc, buf);
        if (pImg) {
          const scale = Math.max(rW / pImg.width, stripH / pImg.height);
          const dw    = pImg.width  * scale;
          const dh    = pImg.height * scale;
          const dx    = rx - (dw - rW) / 2;
          const dy    = bottomY - (dh - stripH) / 2;

          page.drawRectangle({ x: rx, y: bottomY, width: rW, height: stripH, color: C.altRow });
          drawClippedImage(page, pImg, { x: dx, y: dy, width: dw, height: dh },
            { x: rx, y: bottomY, width: rW, height: stripH });

          page.drawRectangle({ x: rx, y: bottomY, width: rW, height: 20,
            color: rgb(0,0,0), opacity: 0.55 });
          page.drawText((img.caption ?? "").toUpperCase(), {
            x: rx + 8, y: bottomY + 7, size: 7, font, color: C.white, opacity: 0.85,
          });
        }
      }
    } catch { /* skip */ }
  }
}

// ─── Safe image helpers ───────────────────────────────────────────────────────

/**
 * Draws an image clipped to a rectangular cell, producing a true "cover crop"
 * (image fills the cell, overflow outside it is hidden) rather than
 * letterboxing. pdf-lib has no built-in image-clip helper, so we use its
 * raw content-stream operators: save state, set a clip path, draw, restore.
 */
function drawClippedImage(
  page: PDFPage,
  img: PDFImage,
  drawRect: { x: number; y: number; width: number; height: number },
  clipRect: { x: number; y: number; width: number; height: number },
) {
  page.pushOperators(
    pushGraphicsState(),
    rectangle(clipRect.x, clipRect.y, clipRect.width, clipRect.height),
    clip(),
    endPath(),
  );
  page.drawImage(img, drawRect);
  page.pushOperators(popGraphicsState());
}

async function fetchRemoteImageSafe(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("/")) {
      const p = `${process.cwd()}/public${url}`;
      if (fs.existsSync(p)) return fs.readFileSync(p);
      return null;
    }
    return await fetchRemoteImage(url);
  } catch {
    return null;
  }
}

async function embedImageSafe(doc: PDFDocument, buf: Buffer) {
  try {
    return await doc.embedJpg(buf);
  } catch {
    try { return await doc.embedPng(buf); } catch { return null; }
  }
}

// ─── Universal image loader (disk or remote) ─────────────────────────────────

async function loadImageBytes(pathOrUrl: string): Promise<Buffer | null> {
  try {
    if (pathOrUrl.startsWith("http")) {
      return await fetchRemoteImage(pathOrUrl);
    }
    // Local disk
    if (fs.existsSync(pathOrUrl)) {
      return fs.readFileSync(pathOrUrl);
    }
    // Try as relative to public/
    const publicPath = require("path").join(process.cwd(), "public", pathOrUrl);
    if (fs.existsSync(publicPath)) {
      return fs.readFileSync(publicPath);
    }
    console.warn("[pdf] Image not found:", pathOrUrl);
    return null;
  } catch (err) {
    console.warn("[pdf] Failed to load image:", pathOrUrl, err);
    return null;
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function slideTitle(page: PDFPage, title: string, font: PDFFont, bold: PDFFont, accent: RGB) {
  page.drawRectangle({ x: M, y: H - M - 10, width: 4, height: 14, color: accent });
  page.drawText(title, { x: M + 12, y: H - M - 5, size: 10, font: bold, color: accent });
  page.drawLine({
    start: { x: M, y: H - M - 22 },
    end:   { x: W - M, y: H - M - 22 },
    thickness: 0.5, color: C.rule,
  });
}

function addSlideFooter(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  pageNum: number,
  total: number,
  firm: FirmProfile | null,
  accent: RGB,
) {
  const firmName    = firm?.name ?? "Architecture Studio";
  const firmTagline = firm?.tagline ?? "";
  const contact     = [firm?.email, firm?.phone, firm?.website].filter(Boolean).join("  ·  ");

  // Footer rule
  page.drawLine({
    start: { x: M, y: M + 24 }, end: { x: W - M, y: M + 24 },
    thickness: 0.4, color: C.rule,
  });

  // Left: firm identity
  const firmLine = firmTagline ? `${firmName}  ·  ${firmTagline}` : firmName;
  page.drawText(firmLine, { x: M, y: M + 12, size: 7.5, font: bold, color: C.muted });
  if (contact) {
    page.drawText(contact, { x: M, y: M + 2, size: 6.5, font, color: C.muted });
  }

  // Right: page number
  const label = `${pageNum} / ${total}`;
  const labelW = font.widthOfTextAtSize(label, 7.5);
  page.drawText(label, { x: W - M - labelW, y: M + 12, size: 7.5, font, color: C.muted });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fetchRemoteImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchRemoteImage(res.headers.location).then(resolve).catch(reject);
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}
