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
  const logoPath = firm?.logoDiskPath ?? firm?.logoUrl;
  if (logoPath) {
    try {
      const ext = logoPath.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
      if (["png","jpg","jpeg","webp"].includes(ext)) {
        const buf = await loadImageBytes(logoPath);
        if (buf) {
          logoBytes = buf;
          logoIsPng = ext === "png";
        }
      }
    } catch { /* logo failed — skip gracefully */ }
  }

  if (project.presentationType === "concept") {
    // ── CONCEPT PRESENTATION ──────────────────────────────────────────
    console.log(`[pdf] Building concept deck: ${project.name}`);
    console.log(`[pdf] Plan: ${(project.aiRenderedPlanUrl ?? project.renderedPlanUrl ?? project.planImagePath ?? "none").slice(0, 80)}`);
    // First-meeting deck: spatial storytelling, no moodboards
    await addCoverSlide(doc, project, firm, accent, reg, bold, italic, logoBytes, logoIsPng);

    if (project.plotInfo && Object.keys(project.plotInfo).length > 0) {
      await addSiteContextSlide(doc, project, accent, reg, bold);
    }

    await addPlanSlide(doc, project, accent, reg, bold);

    if ((project.planStrengths ?? []).length > 0) {
      await addStrengthsSlide(doc, project, project.planStrengths!, accent, reg, bold);
    }

    // Room-by-room narrative walkthrough
    if (project.analysis?.rooms?.length) {
      await addRoomWalkthroughSlide(doc, project, accent, reg, bold, italic);
    }

    // Spatial highlights — area comparisons in plain language
    if (project.analysis?.rooms?.length) {
      await addSpatialHighlightsSlide(doc, project, accent, reg, bold, italic);
    }

    // Vastu compliance check (if facing info is available)
    if (project.plotInfo?.facing && project.analysis?.rooms?.length) {
      await addVastuSlide(doc, project, accent, reg, bold, italic);
    }

  } else {
    // ── INTERIOR PRESENTATION ─────────────────────────────────────────
    // Design-phase deck: moodboards for every room
    await addCoverSlide(doc, project, firm, accent, reg, bold, italic, logoBytes, logoIsPng);

    if (project.plotInfo && Object.keys(project.plotInfo).length > 0) {
      await addSiteContextSlide(doc, project, accent, reg, bold);
    }

    await addPlanSlide(doc, project, accent, reg, bold);

    if ((project.planStrengths ?? []).length > 0) {
      await addStrengthsSlide(doc, project, project.planStrengths!, accent, reg, bold);
    }

    if (project.overallMoodboard) {
      await addOverallMoodboardSlide(doc, project.overallMoodboard, project, accent, reg, bold, italic);
    }

    if (project.roomMoodboards && project.roomMoodboards.length > 0) {
      for (const rm of project.roomMoodboards) {
        await addRoomMoodboardSlide(doc, rm, project, accent, reg, bold);
      }
    } else {
      for (const mb of project.moodboards ?? []) {
        await addMoodboardSlide(doc, mb, accent, reg, bold);
      }
    }
  }

  // Footer on all pages
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    addSlideFooter(pages[i], reg, bold, i + 1, pages.length, firm, accent);
  }

  return Buffer.from(await doc.save());
}

/**
 * Rasterise every page of a generated PDF into an image, one buffer per page.
 *
 * Used by app/api/export/preview to show the actual PDF pages in the
 * Review & Export screen. This is NOT for uploaded floor plan PDFs (those
 * are rasterised client-side). The PDF here is one we generated ourselves
 * with pdf-lib — a simple vector/image PDF that sharp *may* be able to
 * handle (depends on the libvips build). If sharp can't do it, fall back
 * gracefully and let the caller use the JSX preview instead.
 */
export async function rasterizePdfToPageImages(
  pdfBuffer: Buffer,
  density = 130
): Promise<Buffer[]> {
  // Sharp cannot render PDFs on Vercel (no PDF codec in the serverless build).
  // This always fails, so return empty immediately to skip the attempt and
  // let the frontend use the JSX fallback preview.
  if (process.env.VERCEL) {
    return [];
  }

  try {
    const sharp = (await import("sharp")).default;
    const probe = (sharp as unknown as (input: Buffer, opts: object) => import("sharp").Sharp)(
      pdfBuffer, { density }
    );
    const meta = await probe.metadata();
    const pageCount = (meta as unknown as { pages?: number }).pages ?? 1;

    const images: Buffer[] = [];
    for (let i = 0; i < pageCount; i++) {
      const buf = await (sharp as unknown as (input: Buffer, opts: object) => import("sharp").Sharp)(
        pdfBuffer, { density, page: i }
      ).jpeg({ quality: 82 }).toBuffer();
      images.push(buf);
    }
    return images;
  } catch (err) {
    console.warn("[pdf] Rasterisation unavailable:", String(err));
    return [];
  }
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

  // QR code — bottom right corner, links to the shared presentation
  if (project.shareToken && project.shareEnabled !== false) {
    try {
      const { generateQrMatrix, drawQrOnPage } = await import("@/lib/qr");
      const shareUrl = `${process.env.APP_URL ?? "https://archpresent.vercel.app"}/share/${project.shareToken}`;
      const qrMatrix = generateQrMatrix(shareUrl);
      const qrSize = 2.2; // module size in points
      const qrTotal = qrMatrix.length * qrSize;
      const qrX = W - M - qrTotal - 4;
      const qrY = M + FOOTER_H + 8;

      drawQrOnPage(page, qrMatrix, qrX, qrY, qrSize, accent, C.bg);

      // "Scan to view" label
      page.drawText("SCAN TO VIEW", {
        x: qrX + qrTotal / 2 - font.widthOfTextAtSize("SCAN TO VIEW", 5) / 2,
        y: qrY - 8,
        size: 5, font, color: C.muted,
      });
    } catch (err) {
      console.warn("[pdf] QR code generation failed (non-fatal):", err);
    }
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
  // Priority: AI render > color-coded render > original plan
  const planW = W * 0.68;
  const planH = H - 80;
  const planSource = project.aiRenderedPlanUrl ?? project.renderedPlanUrl ?? project.planImagePath;

  try {
    const imgBytes = await loadImageBytes(planSource);
    if (!imgBytes) throw new Error("Could not load plan image");
    // Try PNG first (most common for our plans), fall back to JPEG
    const pdfImg = await doc.embedPng(imgBytes).catch(() => doc.embedJpg(imgBytes));
    const dims     = pdfImg.scaleToFit(planW - M * 2, planH - 20);
    const ix       = M + (planW - M * 2 - dims.width) / 2;
    const iy       = (planH - dims.height) / 2 + 20;
    page.drawImage(pdfImg, { x: ix, y: iy, width: dims.width, height: dims.height });
  } catch {
    // Fallback: try original plan if rendered failed
    try {
      const imgBytes = await loadImageBytes(project.planImagePath);
      if (!imgBytes) throw new Error("fallback also failed");
      const pdfImg = await doc.embedPng(imgBytes).catch(() => doc.embedJpg(imgBytes));
      const dims   = pdfImg.scaleToFit(planW - M * 2, planH - 20);
      const ix     = M + (planW - M * 2 - dims.width) / 2;
      const iy     = (planH - dims.height) / 2 + 20;
      page.drawImage(pdfImg, { x: ix, y: iy, width: dims.width, height: dims.height });
    } catch {
      page.drawRectangle({ x: M, y: 40, width: planW - M * 2, height: planH - 20,
        color: rgb(0.2, 0.2, 0.2) });
      page.drawText("[Floor Plan]", { x: planW / 2 - 40, y: H / 2, size: 12, font, color: C.muted });
    }
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
    let buf: Buffer | null = null;

    if (pathOrUrl.startsWith("http")) {
      buf = await fetchRemoteImage(pathOrUrl);
    } else if (fs.existsSync(pathOrUrl)) {
      buf = fs.readFileSync(pathOrUrl);
    } else {
      const publicPath = require("path").join(process.cwd(), "public", pathOrUrl);
      if (fs.existsSync(publicPath)) buf = fs.readFileSync(publicPath);
    }

    if (!buf) {
      console.warn("[pdf] Image not found:", pathOrUrl.slice(0, 80));
      return null;
    }

    // Validate it's actually an image (not an HTML error page from Supabase/CDN)
    const isPng = buf[0] === 0x89 && buf[1] === 0x50; // PNG magic: 0x89 P
    const isJpg = buf[0] === 0xFF && buf[1] === 0xD8; // JPEG magic: 0xFF 0xD8
    if (!isPng && !isJpg) {
      const preview = buf.slice(0, 50).toString("utf-8").replace(/\n/g, " ");
      console.warn(`[pdf] Not a valid image (${buf.length} bytes, starts with: "${preview}"):`, pathOrUrl.slice(0, 80));
      return null;
    }

    return buf;
  } catch (err) {
    console.warn("[pdf] Failed to load image:", pathOrUrl.slice(0, 80), err);
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

// ─── Concept Presentation: Room Walkthrough slide ─────────────────────────────
//
// A narrative "walk through the home" — each room gets a short paragraph
// describing what makes it work, written in second person ("Your master
// bedroom faces east — morning light fills the room naturally").

async function addRoomWalkthroughSlide(
  doc: PDFDocument,
  project: Project,
  accent: RGB,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont
) {
  const rooms = project.analysis?.rooms ?? [];
  if (rooms.length === 0) return;

  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.dark });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  page.drawText("A WALK THROUGH YOUR HOME", {
    x: M, y: H - M - 4, size: 9, font: bold, color: accent,
  });

  // Subtitle
  page.drawText("Every room has been designed with purpose — here's how your home works for you.", {
    x: M, y: H - M - 22, size: 10, font: italic, color: C.muted,
  });

  // Two-column room descriptions
  const colW = (W - M * 3) / 2;
  const startY = H - M - 50;
  let col = 0;
  let y = startY;
  const lineH = 13;
  const roomGap = 24;

  for (const room of rooms) {
    const x = M + col * (colW + M);

    // Room name
    page.drawText(room.name.toUpperCase(), {
      x, y, size: 8, font: bold, color: accent,
    });
    y -= 3;

    // Separator line
    page.drawLine({
      start: { x, y }, end: { x: x + colW * 0.3, y },
      thickness: 0.5, color: rgb(0.3, 0.3, 0.3),
    });
    y -= lineH;

    // Build a narrative description from the room data
    const desc = buildRoomNarrative(room, project.plotInfo);
    const lines = wrapText(desc, font, 8.5, colW - 10);

    for (const line of lines.slice(0, 4)) { // max 4 lines per room
      page.drawText(line, { x, y, size: 8.5, font, color: C.light });
      y -= lineH;
    }

    y -= roomGap - lineH;

    // Switch column or page if we run out of space
    if (y < M + 40) {
      if (col === 0) {
        col = 1;
        y = startY;
      } else {
        // Need a new page
        col = 0;
        y = startY;
        // Start fresh page for remaining rooms
        const nextPage = doc.addPage([W, H]);
        nextPage.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.dark });
        nextPage.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });
        nextPage.drawText("YOUR HOME — CONTINUED", {
          x: M, y: H - M - 4, size: 9, font: bold, color: accent,
        });
        // Reassign page reference for subsequent drawing
        // (pdf-lib requires drawing on the returned page object)
        break; // For now, limit to one page of walkthrough
      }
    }
  }
}

/**
 * Build a short narrative description of a room for the client walkthrough.
 * Written in second person, varied per room type, avoiding generic filler.
 */
function buildRoomNarrative(room: import("@/types").RoomDetail, plotInfo?: import("@/types").PlotInfo): string {
  const name = room.name.toLowerCase();
  const sqm = room.sizeEstimateSqm;
  const orient = (room.orientation ?? "").toLowerCase();
  const features = room.specialFeatures ?? [];
  const adjacent = room.adjacentRooms ?? [];

  // ── Room-type-specific openers ──────────────────────────────────────
  if (name.includes("master") || (name.includes("bed") && name.includes("1"))) {
    const parts = [`Your primary bedroom${sqm ? ` (${sqm} sqm)` : ""} is positioned for privacy.`];
    if (orient.includes("east")) parts.push("Morning light wakes the room naturally — no alarm needed.");
    else if (orient.includes("north")) parts.push("North-facing for even, glare-free daylight throughout the day.");
    if (features.some(f => f.toLowerCase().includes("walk-in") || f.toLowerCase().includes("wardrobe")))
      parts.push("The attached walk-in keeps the bedroom clutter-free.");
    if (adjacent.some(a => a.toLowerCase().includes("dress") || a.toLowerCase().includes("toilet")))
      parts.push("Dressing and bathroom are directly accessible — a self-contained suite.");
    return parts.join(" ");
  }

  if (name.includes("bed")) {
    const parts = [`This bedroom${sqm ? ` at ${sqm} sqm` : ""} is well-proportioned for comfortable daily use.`];
    if (orient) parts.push(orient.includes("east") ? "East-facing for fresh morning light." : orient.includes("west") ? "Afternoon warmth from the west." : "");
    if (features.length) parts.push(`Includes ${features[0].toLowerCase()}.`);
    return parts.filter(Boolean).join(" ");
  }

  if (name.includes("drawing") || name.includes("living")) {
    const parts = [`The main living space${sqm ? ` (${sqm} sqm)` : ""} is where your family gathers and guests are welcomed.`];
    if (orient.includes("east")) parts.push("East-facing — bright and inviting through the morning hours.");
    if (features.some(f => f.toLowerCase().includes("double height"))) parts.push("Double-height volume gives it a sense of grandeur.");
    if (features.some(f => f.toLowerCase().includes("deck"))) parts.push("The attached deck extends the living space outdoors.");
    return parts.join(" ");
  }

  if (name.includes("kitchen")) {
    const parts = [`The kitchen${sqm ? ` (${sqm} sqm)` : ""} is designed for efficient workflow.`];
    if (adjacent.some(a => a.toLowerCase().includes("dining") || a.toLowerCase().includes("lobby")))
      parts.push("Direct access to the dining area keeps serving seamless.");
    if (adjacent.some(a => a.toLowerCase().includes("servant") || a.toLowerCase().includes("utility")))
      parts.push("A connected service area handles the heavy-duty work.");
    return parts.join(" ");
  }

  if (name.includes("lobby") || name.includes("dining") || name.includes("dinning")) {
    const parts = [`The lobby and dining area${sqm ? ` (${sqm} sqm)` : ""} forms the circulation spine of the home.`];
    parts.push("It connects the social and private zones while providing a generous dining space for family meals.");
    return parts.join(" ");
  }

  if (name.includes("pooja") || name.includes("puja")) {
    return `A dedicated prayer space${sqm ? ` (${sqm} sqm)` : ""} — quiet, inward-facing, and positioned per tradition. ${orient.includes("east") ? "East-facing for morning worship." : ""}`.trim();
  }

  if (name.includes("dress") || name.includes("w.i.w") || name.includes("wardrobe")) {
    return `Attached dressing area${sqm ? ` (${sqm} sqm)` : ""} with room for organised storage — keeping the bedroom itself clean and restful.`;
  }

  if (name.includes("toilet") || name.includes("bath")) {
    const attached = adjacent.length ? `Serves ${adjacent[0]}.` : "";
    return `${sqm ? `${sqm} sqm` : "A compact"} bathroom designed for efficient daily use. ${attached}`.trim();
  }

  if (name.includes("porch") || name.includes("entry")) {
    return `The entry porch${sqm ? ` (${sqm} sqm)` : ""} creates a transition from the street to the home — a moment of arrival before stepping inside.`;
  }

  if (name.includes("stair")) {
    return `The staircase area${sqm ? ` (${sqm} sqm)` : ""} provides vertical circulation between floors.`;
  }

  if (name.includes("servant") || name.includes("utility") || name.includes("maid")) {
    return `Service area${sqm ? ` (${sqm} sqm)` : ""} — kept separate from the main living spaces for practical daily operation.`;
  }

  if (name.includes("lift")) {
    return `Future-ready lift provision${sqm ? ` (${sqm} sqm)` : ""} — adds convenience and long-term accessibility to the home.`;
  }

  // Generic fallback
  const parts = [`${room.name}${sqm ? ` (${sqm} sqm)` : ""}`];
  if (orient) parts.push(`${orient.charAt(0).toUpperCase() + orient.slice(1)}-oriented.`);
  if (features.length) parts.push(`Features: ${features.slice(0, 2).join(", ")}.`);
  return parts.join(" — ") + ".";
}


// ─── Concept Presentation: Spatial Highlights slide ───────────────────────────
//
// Lifestyle-focused insights about the plan — not just numbers, but what
// those numbers mean for daily living.

async function addSpatialHighlightsSlide(
  doc: PDFDocument,
  project: Project,
  accent: RGB,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont
) {
  const rooms = project.analysis?.rooms ?? [];
  if (rooms.length === 0) return;

  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.dark });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  page.drawText("WHY THIS PLAN WORKS", {
    x: M, y: H - M - 4, size: 9, font: bold, color: accent,
  });

  page.drawText("The key design decisions that make this home work for everyday life.", {
    x: M, y: H - M - 22, size: 10, font: italic, color: C.muted,
  });

  // Build meaningful insights instead of raw stats
  const insights: { icon: string; title: string; detail: string }[] = [];

  // Privacy zoning
  const bedrooms = rooms.filter(r => r.name.toLowerCase().includes("bed"));
  const livingRooms = rooms.filter(r =>
    r.name.toLowerCase().includes("living") || r.name.toLowerCase().includes("drawing") ||
    r.name.toLowerCase().includes("lobby") || r.name.toLowerCase().includes("dining"));
  if (bedrooms.length > 0 && livingRooms.length > 0) {
    insights.push({
      icon: "01",
      title: "Private & Social Zones",
      detail: `${bedrooms.length} bedroom${bedrooms.length > 1 ? "s" : ""} are separated from the ${livingRooms.length} social space${livingRooms.length > 1 ? "s" : ""} — guests never intrude on your private areas.`,
    });
  }

  // Orientation advantage
  const facing = project.plotInfo?.facing;
  if (facing) {
    const f = facing.toLowerCase();
    const benefit = f.includes("east")
      ? "Living spaces get gentle morning sun — naturally bright without harsh glare. Bedrooms stay cool in the afternoon."
      : f.includes("north")
      ? "Consistent, even daylight throughout the day — ideal for Indian climates where south/west sun can be intense."
      : f.includes("west")
      ? "Warm afternoon light in the living areas — perfect for evening family time."
      : "Balanced natural light across the home.";
    insights.push({ icon: "02", title: `${facing}-Facing Advantage`, detail: benefit });
  }

  // Self-contained bedroom suites
  const suiteBedrooms = bedrooms.filter(b =>
    (b.adjacentRooms ?? []).some(a =>
      a.toLowerCase().includes("dress") || a.toLowerCase().includes("toilet") || a.toLowerCase().includes("bath")
    )
  );
  if (suiteBedrooms.length > 0) {
    insights.push({
      icon: "03",
      title: `${suiteBedrooms.length} Self-Contained Suite${suiteBedrooms.length > 1 ? "s" : ""}`,
      detail: `${suiteBedrooms.length > 1 ? "Each" : "The"} bedroom has attached dressing and bathroom — no sharing, no morning queues.`,
    });
  }

  // Kitchen workflow
  const kitchen = rooms.find(r => r.name.toLowerCase().includes("kitchen") && !r.name.toLowerCase().includes("servant"));
  if (kitchen) {
    const hasServiceKitchen = rooms.some(r => r.name.toLowerCase().includes("servant") || r.name.toLowerCase().includes("service"));
    if (hasServiceKitchen) {
      insights.push({
        icon: "04",
        title: "Dual Kitchen Setup",
        detail: "Main kitchen for family cooking, separate service kitchen for heavy-duty work — keeps the main space clean and presentable.",
      });
    } else {
      insights.push({
        icon: "04",
        title: "Efficient Kitchen",
        detail: `${kitchen.sizeEstimateSqm ? `${kitchen.sizeEstimateSqm} sqm kitchen` : "Kitchen"} with direct dining access — cooking and serving flow naturally.`,
      });
    }
  }

  // Pooja room
  const pooja = rooms.find(r => r.name.toLowerCase().includes("pooja") || r.name.toLowerCase().includes("puja"));
  if (pooja) {
    const poojaOrient = (pooja.orientation ?? "").toLowerCase();
    insights.push({
      icon: "05",
      title: "Dedicated Pooja Room",
      detail: `A separate prayer space${poojaOrient.includes("east") ? " facing east, as per Vastu" : ""} — not a corner of another room, but a proper, peaceful space.`,
    });
  }

  // Future readiness (lift)
  const hasLift = rooms.some(r => r.name.toLowerCase().includes("lift"));
  if (hasLift) {
    insights.push({
      icon: "06",
      title: "Lift-Ready",
      detail: "Lift provision built into the plan — accessibility for elderly family members and long-term convenience.",
    });
  }

  // Render insights as rows
  const startY = H - M - 55;
  const rowH = 52;

  insights.slice(0, 5).forEach((insight, i) => {
    const y = startY - i * rowH;

    // Icon circle
    page.drawCircle({
      x: M + 14, y: y - 4, size: 12,
      color: accent, opacity: 0.15,
    });
    page.drawText(insight.icon, {
      x: M + 9, y: y - 8, size: 11, font: bold, color: accent,
    });

    // Title
    page.drawText(insight.title.toUpperCase(), {
      x: M + 38, y: y, size: 8, font: bold, color: C.light,
    });

    // Detail
    const detailLines = wrapText(insight.detail, font, 8.5, W - M * 2 - 50);
    detailLines.slice(0, 2).forEach((line, li) => {
      page.drawText(line, {
        x: M + 38, y: y - 14 - li * 11, size: 8.5, font, color: C.muted,
      });
    });

    // Divider
    if (i < insights.length - 1) {
      page.drawLine({
        start: { x: M + 38, y: y - rowH + 12 },
        end: { x: W - M, y: y - rowH + 12 },
        thickness: 0.3, color: rgb(0.2, 0.2, 0.2),
      });
    }
  });
}

// ─── Concept: Vastu Compliance slide ──────────────────────────────────────────

async function addVastuSlide(
  doc: PDFDocument,
  project: Project,
  accent: RGB,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont
) {
  const rooms = project.analysis?.rooms ?? [];
  const facing = (project.plotInfo?.facing ?? "").toLowerCase();
  if (!facing || rooms.length === 0) return;

  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.dark });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  page.drawText("VASTU ANALYSIS", {
    x: M, y: H - M - 4, size: 9, font: bold, color: accent,
  });

  page.drawText("How this plan aligns with Vastu Shastra principles.", {
    x: M, y: H - M - 22, size: 10, font: italic, color: C.muted,
  });

  // Vastu rules for room placement
  const vastuRules: { room: string; ideal: string; direction: string; match: (orient: string) => boolean }[] = [
    { room: "Master Bedroom", ideal: "South-West", direction: "sw",
      match: (o) => o.includes("south") || o.includes("west") },
    { room: "Kitchen", ideal: "South-East", direction: "se",
      match: (o) => o.includes("south") || o.includes("east") },
    { room: "Pooja Room", ideal: "North-East", direction: "ne",
      match: (o) => o.includes("north") || o.includes("east") },
    { room: "Living Room", ideal: "North or East", direction: "ne",
      match: (o) => o.includes("north") || o.includes("east") },
    { room: "Dining", ideal: "West", direction: "w",
      match: (o) => o.includes("west") },
    { room: "Bathroom", ideal: "North-West", direction: "nw",
      match: (o) => o.includes("north") || o.includes("west") },
    { room: "Entrance", ideal: "East or North", direction: "ne",
      match: (o) => o.includes("east") || o.includes("north") },
    { room: "Staircase", ideal: "South-West", direction: "sw",
      match: (o) => o.includes("south") || o.includes("west") },
  ];

  const results: { rule: string; ideal: string; actual: string; pass: boolean; note: string }[] = [];

  for (const rule of vastuRules) {
    // Find matching room in the analysis
    const matchedRoom = rooms.find(r => {
      const n = r.name.toLowerCase();
      const rn = rule.room.toLowerCase();
      return n.includes(rn.split(" ")[0]) || (rn.includes("entrance") && (n.includes("entry") || n.includes("porch") || n.includes("lobby")));
    });

    if (matchedRoom && matchedRoom.orientation) {
      const orient = matchedRoom.orientation.toLowerCase();
      const pass = rule.match(orient);
      results.push({
        rule: rule.room,
        ideal: rule.ideal,
        actual: matchedRoom.orientation,
        pass,
        note: pass
          ? `Correctly placed — ${matchedRoom.orientation} aligns with Vastu`
          : `Currently ${matchedRoom.orientation} — Vastu recommends ${rule.ideal}`,
      });
    }
  }

  // Main entrance check
  if (facing) {
    const entranceGood = facing.includes("east") || facing.includes("north");
    results.unshift({
      rule: "Main Entrance",
      ideal: "East or North",
      actual: project.plotInfo?.facing ?? "",
      pass: entranceGood,
      note: entranceGood
        ? "East/North entrance is considered very auspicious"
        : `${project.plotInfo?.facing} entrance — Vastu prefers East or North`,
    });
  }

  if (results.length === 0) return;

  // Vastu score
  const passCount = results.filter(r => r.pass).length;
  const score = Math.round((passCount / results.length) * 100);

  // Score display
  page.drawText(`${score}%`, {
    x: W - M - 80, y: H - M - 10, size: 36, font: bold, color: accent,
  });
  page.drawText("VASTU SCORE", {
    x: W - M - 80, y: H - M - 48, size: 7, font, color: C.muted,
  });

  // Results list
  const startY = H - M - 55;
  const rowH = 36;

  results.slice(0, 7).forEach((r, i) => {
    const y = startY - i * rowH;

    // Pass/fail indicator
    const indicator = r.pass ? "OK" : "--";
    const indicatorColor = r.pass ? rgb(0.2, 0.7, 0.4) : rgb(0.6, 0.4, 0.2);
    page.drawText(indicator, {
      x: M, y: y, size: 9, font: bold, color: indicatorColor,
    });

    // Room name + ideal direction
    page.drawText(`${r.rule.toUpperCase()}`, {
      x: M + 30, y: y, size: 8, font: bold, color: C.light,
    });
    page.drawText(`Ideal: ${r.ideal}  |  Actual: ${r.actual}`, {
      x: M + 30, y: y - 13, size: 7.5, font, color: C.muted,
    });

    // Note
    const noteLines = wrapText(r.note, font, 7, W - M * 2 - 40);
    noteLines.slice(0, 1).forEach((line, li) => {
      page.drawText(line, {
        x: M + 30, y: y - 24 - li * 10, size: 7, font: italic, color: C.muted,
      });
    });
  });

  // Disclaimer
  page.drawText("Vastu analysis is indicative — based on room orientation data from AI analysis.", {
    x: M, y: M + FOOTER_H + 8, size: 6, font, color: C.muted,
  });
}
