/**
 * lib/pdf.ts
 *
 * 16:9 widescreen PDF deck — 1190 × 669 pt (close to 16:9 at 72 dpi).
 * Designed like a keynote slide, not a document.
 *
 * Design rules (each slide answers exactly ONE client question):
 *   1. Cover            — "Who is this from?"
 *   2. Site Context     — "Where is my plot?"      → stat grid + compass
 *   3. Floor Plan       — "What does my home look like?" → plan dominates
 *   4. Strengths        — "Why is this plan good?"  → max 5, big numerals
 *   5+. Walkthrough     — "What's in each room?"    → 6 room cards / slide
 *   6. Why This Works   — "How does this fit MY life?" → insight cards
 *   7. Vastu (opt-in)   — "Is it Vastu-compliant?"  → score + pass/fail
 *   8+. Moodboards      — interior decks only
 *
 * Surface + typography come from lib/pdfTheme.ts (the firm's chosen preset);
 * the firm's accent colour is layered on top so branding survives a theme
 * switch.
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
import { buildRoomNarrative } from "@/lib/narrative";
import { getPdfTheme, PdfTheme, TYPE, ts } from "@/lib/pdfTheme";

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

// Surfaces and type now come from the firm's chosen preset — see
// lib/pdfTheme.ts. (The old hardcoded `C` palette also referenced a `C.dark`
// key that was never defined, so pdf-lib silently fell back to pure black on
// the walkthrough / highlights / vastu slides.)

// Pass/fail indicator colours — semantic, so they stay constant across themes.
const PASS = rgb(0.18, 0.62, 0.38);
const FAIL = rgb(0.72, 0.45, 0.16);

// Text sitting directly on a photographic moodboard image is always light,
// regardless of preset — the image, not the theme, is the surface underneath.
const ON_IMAGE       = rgb(0.96, 0.96, 0.95);
const ON_IMAGE_MUTED = rgb(0.74, 0.74, 0.72);

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Result of a deck build.
 *
 * `pageLabels` is emitted BY the builder, one entry per page actually added,
 * so callers never have to maintain a parallel guess at the deck's structure.
 * The Export screen used to keep its own hand-written `slides` array and index
 * page images against it — which silently dropped the Thank You slide and
 * mislabelled every page after the walkthrough once that started paginating.
 */
export interface DeckBuild {
  bytes: Buffer;
  pageLabels: string[];
}

export async function buildProjectPdf(project: Project): Promise<DeckBuild> {
  const firm   = await firmStore.get();
  const accent = ACCENT_COLORS[firm?.accentColor ?? "graphite"];

  // The firm's chosen visual preset. Threaded explicitly through every slide
  // rather than held in module scope, so concurrent exports in the same
  // serverless process can't clobber each other's theme mid-render.
  const t = getPdfTheme(project.presentationTheme);

  // Labels are recorded as each page is added, keyed off the page object, so
  // the order can never disagree with the document.
  const labels = new Map<PDFPage, string>();
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

  // Wrap each section so it labels whatever pages it produced. A section may
  // add more than one page (the walkthrough paginates), so labels are derived
  // from the document itself rather than assumed 1:1.
  async function section(label: string, fn: () => Promise<void>) {
    const before = doc.getPageCount();
    await fn();
    const added = doc.getPageCount() - before;
    for (let i = 0; i < added; i++) {
      labels.set(doc.getPage(before + i), added > 1 ? `${label} ${i + 1}/${added}` : label);
    }
  }

  if (project.presentationType === "concept") {
    // ── CONCEPT PRESENTATION ──────────────────────────────────────────
    console.log(`[pdf] Building concept deck: ${project.name} (theme: ${t.id})`);
    console.log(`[pdf] Plan: ${(project.aiRenderedPlanUrl ?? project.renderedPlanUrl ?? project.planImagePath ?? "none").slice(0, 80)}`);
    // First-meeting deck: spatial storytelling, no moodboards
    await section("Cover", () => addCoverSlide(doc, project, firm, accent, t, reg, bold, italic, logoBytes, logoIsPng));

    if (project.plotInfo && Object.keys(project.plotInfo).length > 0) {
      await section("Site Context", () => addSiteContextSlide(doc, project, accent, t, reg, bold));
    }

    await section("Floor Plan", () => addPlanSlide(doc, project, accent, t, reg, bold));

    if ((project.planStrengths ?? []).length > 0) {
      await section("Plan Strengths", () => addStrengthsSlide(doc, project, project.planStrengths!, accent, t, reg, bold));
    }

    // Room-by-room narrative walkthrough — paginates across as many slides
    // as the rooms need.
    if (project.analysis?.rooms?.length) {
      await section("Room Walkthrough", () => addRoomWalkthroughSlide(doc, project, accent, t, reg, bold, italic));
    }

    // Lifestyle insights tied back to the client brief
    if (project.analysis?.rooms?.length) {
      await section("Why This Works", () => addSpatialHighlightsSlide(doc, project, accent, t, reg, bold, italic));
    }

    // Vastu compliance check (only if client opted in)
    if (project.plotInfo?.showVastu && project.plotInfo?.facing && project.analysis?.rooms?.length) {
      await section("Vastu Analysis", () => addVastuSlide(doc, project, accent, t, reg, bold, italic));
    }

    await section("Thank You", () => addThankYouSlide(doc, project, firm, accent, t, reg, bold, italic));

  } else {
    // ── INTERIOR PRESENTATION ─────────────────────────────────────────
    // Design-phase deck: moodboards for every room
    await section("Cover", () => addCoverSlide(doc, project, firm, accent, t, reg, bold, italic, logoBytes, logoIsPng));

    if (project.plotInfo && Object.keys(project.plotInfo).length > 0) {
      await section("Site Context", () => addSiteContextSlide(doc, project, accent, t, reg, bold));
    }

    await section("Floor Plan", () => addPlanSlide(doc, project, accent, t, reg, bold));

    if ((project.planStrengths ?? []).length > 0) {
      await section("Plan Strengths", () => addStrengthsSlide(doc, project, project.planStrengths!, accent, t, reg, bold));
    }

    if (project.overallMoodboard) {
      await section("Interior Style", () => addOverallMoodboardSlide(doc, project.overallMoodboard!, project, accent, t, reg, bold, italic));
    }

    if (project.roomMoodboards && project.roomMoodboards.length > 0) {
      for (const rm of project.roomMoodboards) {
        await section(rm.roomName, () => addRoomMoodboardSlide(doc, rm, project, accent, t, reg, bold));
      }
    } else {
      for (const mb of project.moodboards ?? []) {
        await section(mb.roomName, () => addMoodboardSlide(doc, mb, accent, t, reg, bold));
      }
    }

    await section("Thank You", () => addThankYouSlide(doc, project, firm, accent, t, reg, bold, italic));
  }

  // Footer on all pages except the cover (page 1) and the closing slide,
  // which carry their own identity block.
  const pages = doc.getPages();
  for (let i = 1; i < pages.length - 1; i++) {
    addSlideFooter(pages[i], reg, bold, i + 1, pages.length, firm, accent, t, FEATURE_PAGES.has(pages[i]));
  }

  const pageLabels = doc.getPages().map((pg, i) => labels.get(pg) ?? `Page ${i + 1}`);
  return { bytes: Buffer.from(await doc.save()), pageLabels };
}

// NOTE: server-side rasterisation (sharp) used to live here, to turn the
// generated PDF into page images for the Export screen. Sharp has no PDF
// codec in Vercel's serverless build, so it always failed there and the UI
// silently fell back to a hand-maintained JSX mockup that had drifted from
// the real deck. The Export screen now renders these PDF bytes directly with
// pdf.js in the browser, so preview and download can never disagree.

// ─── 1. Cover slide ───────────────────────────────────────────────────────────
// Layout: left half = accent color block, right half = off-white with text

async function addCoverSlide(
  doc: PDFDocument,
  project: Project,
  firm: FirmProfile | null,
  accent: RGB,
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont,
  logoBytes: Uint8Array | null,
  logoIsPng: boolean,
) {
  const page = doc.addPage([W, H]);

  // The cover answers exactly one question: "who is this from, and what is
  // it?" Everything else (specs, QR, tagline) is secondary and sized as such.
  const isSplit = t.coverStyle === "split";
  const isBand  = t.coverStyle === "band";

  // ── Surface ────────────────────────────────────────────────────────────
  const splitX = Math.round(W * 0.46);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: t.pageBg });

  if (isSplit) {
    page.drawRectangle({ x: 0, y: 0, width: splitX, height: H, color: accent });
  } else if (isBand) {
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: t.featureBg });
    page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: accent });
  } else {
    // "quiet" — no colour field at all; a single hairline carries the layout.
    page.drawLine({
      start: { x: M, y: H * 0.62 }, end: { x: M + 90, y: H * 0.62 },
      thickness: 2.5, color: accent,
    });
  }

  // Text colours depend on which field the copy sits on.
  const onColour   = isSplit;
  const titleColor = onColour ? t.white : (isBand ? t.onFeature : t.ink);
  const subColor   = onColour ? t.white : (isBand ? t.onFeatureMuted : t.muted);
  const subOpacity = onColour ? 0.72 : 1;

  const cx = isSplit ? M : M;
  const contentW = isSplit ? splitX - M * 2 : W * 0.62 - M;

  // ── Kicker ─────────────────────────────────────────────────────────────
  const kicker = project.presentationType === "concept"
    ? "CONCEPT PRESENTATION"
    : "INTERIOR PRESENTATION";
  page.drawText(kicker, {
    x: cx, y: H - M - 4,
    size: ts(t, TYPE.kicker), font: bold,
    color: onColour ? t.white : accent,
    opacity: onColour ? 0.65 : 1,
  });

  // ── Project name — the single biggest thing on the page ────────────────
  const nameSize = ts(t, 46);
  const projLines = wrapText(project.name, bold, nameSize, contentW);
  let projY = isSplit ? H * 0.60 : H * 0.52;
  for (const line of projLines.slice(0, 3)) {
    page.drawText(line, { x: cx, y: projY, size: nameSize, font: bold, color: titleColor });
    projY -= nameSize + 8;
  }

  // ── Prepared for ───────────────────────────────────────────────────────
  page.drawLine({
    start: { x: cx, y: projY + 4 },
    end:   { x: cx + Math.min(contentW, 120), y: projY + 4 },
    thickness: 1, color: onColour ? t.white : accent,
    opacity: onColour ? 0.35 : 1,
  });

  page.drawText("PREPARED FOR", {
    x: cx, y: projY - 26, size: ts(t, 9.5), font, color: subColor, opacity: subOpacity * 0.8,
  });
  page.drawText(project.clientName, {
    x: cx, y: projY - 48, size: ts(t, 19), font: bold, color: titleColor, opacity: onColour ? 0.95 : 1,
  });

  const dateStr = new Date(project.createdAt).toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });
  page.drawText(dateStr, {
    x: cx, y: M + 18, size: ts(t, TYPE.caption), font, color: subColor, opacity: subOpacity * 0.75,
  });

  // ── Right side — firm identity + key specs ─────────────────────────────
  const rx = isSplit ? splitX + M : W * 0.68;

  if (logoBytes) {
    try {
      const img  = logoIsPng ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes);
      const dims = img.scaleToFit(150, 54);
      page.drawImage(img, {
        x: W - M - dims.width, y: H - M - dims.height + 4,
        width: dims.width, height: dims.height,
      });
    } catch { /* fall through to the text lockup below */ }
  }

  const firmName = (firm?.name ?? project.firmName).toUpperCase();
  const fnW = bold.widthOfTextAtSize(firmName, ts(t, 11));
  page.drawText(firmName, {
    x: W - M - fnW, y: logoBytes ? H - M - 64 : H - M - 4,
    size: ts(t, 11), font: bold,
    color: isBand ? t.onFeature : (isSplit ? t.ink : t.ink),
  });

  if (firm?.tagline) {
    const tW = font.widthOfTextAtSize(firm.tagline, ts(t, TYPE.caption));
    page.drawText(firm.tagline, {
      x: W - M - tW, y: (logoBytes ? H - M - 64 : H - M - 4) - 16,
      size: ts(t, TYPE.caption), font,
      color: isBand ? t.onFeatureMuted : t.muted,
    });
  }

  // Key specs — a short, scannable stack rather than a run-on line.
  const specs: { label: string; value: string }[] = [];
  const pi = project.plotInfo;
  if (pi?.numberOfBedrooms) specs.push({ label: "CONFIGURATION", value: `${pi.numberOfBedrooms} BHK` });
  if (pi?.builtUpAreaSqm)   specs.push({ label: "BUILT-UP AREA", value: `${pi.builtUpAreaSqm} sqm` });
  else if (pi?.plotAreaSqm) specs.push({ label: "PLOT AREA", value: `${pi.plotAreaSqm} sqm` });
  if (pi?.facing)           specs.push({ label: "FACING", value: pi.facing });

  if (specs.length > 0 && !isSplit) {
    let sy = H * 0.52;
    for (const s of specs) {
      page.drawText(s.label, {
        x: rx, y: sy, size: ts(t, 8.5), font,
        color: isBand ? t.onFeatureMuted : t.muted,
      });
      page.drawText(s.value, {
        x: rx, y: sy - 20, size: ts(t, 17), font: bold,
        color: isBand ? t.onFeature : t.ink,
      });
      sy -= 54;
    }
  } else if (specs.length > 0) {
    let sy = H * 0.60;
    for (const s of specs) {
      page.drawText(s.label, { x: rx, y: sy, size: ts(t, 8.5), font, color: t.muted });
      page.drawText(s.value, { x: rx, y: sy - 20, size: ts(t, 17), font: bold, color: t.ink });
      sy -= 54;
    }
  }

  // QR geometry is computed before the tagline so the tagline can reserve
  // space for it — otherwise long taglines run straight through the code.
  const hasQr = Boolean(project.shareToken && project.shareEnabled !== false);
  const qrModule = 2.4;
  const qrTotal  = hasQr ? 33 * qrModule : 0;   // QR matrices here are 33×33
  const qrX      = W - M - qrTotal;
  const qrY      = M + 16;

  if (firm?.coverTagline) {
    const tagRight = hasQr ? qrX - 24 : W - M;
    const tagW = Math.max(160, tagRight - rx);
    const tagLines = wrapText(firm.coverTagline, italic, ts(t, 15), tagW);
    let ty = M + 84;
    for (const line of tagLines.slice(0, 3)) {
      page.drawText(line, {
        x: rx, y: ty, size: ts(t, 15), font: italic,
        color: isBand ? t.onFeatureMuted : t.muted,
      });
      ty -= 20;
    }
  }

  // QR — bottom right, links to the live share link.
  if (hasQr) {
    try {
      const { generateQrMatrix, drawQrOnPage } = await import("@/lib/qr");
      const shareUrl = `${process.env.APP_URL ?? "https://archpresent.vercel.app"}/share/${project.shareToken}`;
      const qrMatrix = generateQrMatrix(shareUrl);
      const actualTotal = qrMatrix.length * qrModule;
      const ax = W - M - actualTotal;

      const qrBg = isBand ? t.white : t.pageBg;
      const qrFg = isBand ? t.featureBg : accent;
      // Pad behind the modules so the code stays scannable on any surface.
      page.drawRectangle({
        x: ax - 6, y: qrY - 6, width: actualTotal + 12, height: actualTotal + 12, color: qrBg,
      });
      drawQrOnPage(page, qrMatrix, ax, qrY, qrModule, qrFg, qrBg);

      const lbl = "SCAN TO VIEW ONLINE";
      page.drawText(lbl, {
        x: ax + actualTotal / 2 - font.widthOfTextAtSize(lbl, ts(t, 7.5)) / 2,
        y: qrY - 16, size: ts(t, 7.5), font,
        color: isBand ? t.onFeatureMuted : t.muted,
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
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  slideBackground(page, t, accent);

  const italic = font; // site context has no italic copy; keep the signature small
  slideHeader(page, {
    kicker: "Site Context",
    headline: "Where your home sits",
  }, t, font, bold, italic, accent);

  const p = project.plotInfo!;

  // A stat grid, not a spec table. Each fact gets a big value and a small
  // label, so a client can read the whole slide in one glance instead of
  // parsing rows.
  const stats: { label: string; value: string }[] = [];
  if (p.propertyType)     stats.push({ label: "PROPERTY TYPE",  value: p.propertyType });
  if (p.numberOfBedrooms) stats.push({ label: "CONFIGURATION",  value: `${p.numberOfBedrooms} BHK` });
  if (p.builtUpAreaSqm)   stats.push({ label: "BUILT-UP AREA",  value: `${p.builtUpAreaSqm} sqm` });
  if (p.plotAreaSqm)      stats.push({ label: "PLOT AREA",      value: `${p.plotAreaSqm} sqm` });
  if (p.floorLocation)    stats.push({ label: "FLOOR",          value: `${p.floorLocation}` });
  if (p.numberOfFloors)   stats.push({ label: "FLOORS",         value: String(p.numberOfFloors) });

  // Left 60% = stats, right 40% = compass.
  const gridW  = W * 0.56 - M;
  const cols   = 2;
  const cardW  = (gridW - 20) / cols;
  const cardH  = 92;
  const gridTop = H - 210;

  stats.slice(0, 6).forEach((s, i) => {
    const cxp = M + (i % cols) * (cardW + 20);
    const cyp = gridTop - Math.floor(i / cols) * (cardH + 16);

    if (t.filledCards) {
      page.drawRectangle({ x: cxp, y: cyp, width: cardW, height: cardH, color: t.panel });
    } else {
      page.drawLine({
        start: { x: cxp, y: cyp }, end: { x: cxp + cardW, y: cyp },
        thickness: 0.75, color: t.rule,
      });
    }
    // Accent tick — a small brand cue that doesn't cost legibility.
    page.drawRectangle({ x: cxp, y: cyp, width: 3, height: cardH, color: accent });

    page.drawText(s.label, {
      x: cxp + 18, y: cyp + cardH - 26, size: ts(t, TYPE.statLabel), font, color: t.muted,
    });
    page.drawText(s.value, {
      x: cxp + 18, y: cyp + 22, size: ts(t, TYPE.statValue), font: bold, color: t.ink,
    });
  });

  if (p.additionalNotes) {
    const notesY = gridTop - Math.ceil(Math.min(stats.length, 6) / cols) * (cardH + 16) - 10;
    if (notesY > M + 40) {
      page.drawText("NOTES", { x: M, y: notesY, size: ts(t, TYPE.statLabel), font: bold, color: t.muted });
      let ny = notesY - 18;
      for (const line of wrapText(p.additionalNotes, font, ts(t, TYPE.body), gridW).slice(0, 2)) {
        page.drawText(line, { x: M, y: ny, size: ts(t, TYPE.body), font, color: t.ink });
        ny -= ts(t, TYPE.body) + 5;
      }
    }
  }

  // ── Compass — right panel ──────────────────────────────────────────────
  if (p.facing) {
    const cx = W * 0.78;
    const cy = H * 0.46;
    const r  = 118;

    page.drawCircle({ x: cx, y: cy, size: r + 6, color: t.panel });
    page.drawCircle({
      x: cx, y: cy, size: r,
      borderColor: t.rule, borderWidth: 1.5,
      color: t.filledCards ? t.white : t.pageBg,
    });

    for (let deg = 0; deg < 360; deg += 45) {
      const rad2 = (deg * Math.PI) / 180;
      const isCardinal = deg % 90 === 0;
      const innerR = isCardinal ? r - 14 : r - 8;
      page.drawLine({
        start: { x: cx + Math.cos(rad2) * innerR, y: cy + Math.sin(rad2) * innerR },
        end:   { x: cx + Math.cos(rad2) * r,      y: cy + Math.sin(rad2) * r },
        thickness: isCardinal ? 1.2 : 0.6, color: t.muted,
      });
    }

    page.drawCircle({ x: cx, y: cy, size: 5, color: accent });

    const cardinals = [
      { l: "N", dx: 0, dy: r + 20 }, { l: "S", dx: 0, dy: -r - 32 },
      { l: "E", dx: r + 16, dy: -6 }, { l: "W", dx: -r - 32, dy: -6 },
    ];
    for (const c of cardinals) {
      const active = p.facing!.startsWith(c.l);
      page.drawText(c.l, {
        x: cx + c.dx - 5, y: cy + c.dy,
        size: ts(t, 15), font: active ? bold : font,
        color: active ? accent : t.muted,
      });
    }

    const angles: Record<string, number> = {
      North: 90, South: 270, East: 0, West: 180,
      "North-East": 45, "North-West": 135, "South-East": 315, "South-West": 225,
    };
    const rad = ((angles[p.facing] ?? 90) * Math.PI) / 180;
    const tipX = cx + Math.cos(rad) * (r - 12);
    const tipY = cy + Math.sin(rad) * (r - 12);

    page.drawLine({ start: { x: cx, y: cy }, end: { x: tipX, y: tipY }, thickness: 4, color: accent });

    // Arrowhead as two short lines — pdf-lib's drawSvgPath renders
    // multi-segment paths unreliably.
    const headLen = 12, headAngle = 0.5;
    const back1 = { x: tipX - headLen * Math.cos(rad - headAngle), y: tipY - headLen * Math.sin(rad - headAngle) };
    const back2 = { x: tipX - headLen * Math.cos(rad + headAngle), y: tipY - headLen * Math.sin(rad + headAngle) };
    page.drawLine({ start: { x: tipX, y: tipY }, end: back1, thickness: 4, color: accent });
    page.drawLine({ start: { x: tipX, y: tipY }, end: back2, thickness: 4, color: accent });

    const facingLabel = `${p.facing.toUpperCase()} FACING`;
    page.drawText(facingLabel, {
      x: cx - bold.widthOfTextAtSize(facingLabel, ts(t, 12)) / 2,
      y: cy - r - 52, size: ts(t, 12), font: bold, color: accent,
    });

    // Say what the orientation actually means for daily life — the compass
    // alone is decoration to most clients.
    const f = p.facing.toLowerCase();
    const meaning = f.includes("east")
      ? "Gentle morning sun, cooler afternoons."
      : f.includes("north")
      ? "Even, glare-free daylight all day."
      : f.includes("west")
      ? "Warm afternoon and evening light."
      : "Balanced light through the day.";
    page.drawText(meaning, {
      x: cx - font.widthOfTextAtSize(meaning, ts(t, TYPE.caption)) / 2,
      y: cy - r - 70, size: ts(t, TYPE.caption), font, color: t.muted,
    });
  }
}

// ─── 3. Floor plan slide ──────────────────────────────────────────────────────
// Dark background, plan centered, room list on right side

async function addPlanSlide(
  doc: PDFDocument, project: Project, accent: RGB, t: PdfTheme, font: PDFFont, bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  slideBackground(page, t, accent, true);

  const onFeature = isDarkSurface(t.featureBg);
  const titleCol  = t.onFeature;
  const mutedCol  = t.onFeatureMuted;

  // This slide exists so the client can look at their home. The plan gets the
  // space; the room list is a quiet sidebar, not a competing column.
  page.drawText("FLOOR PLAN", {
    x: M, y: H - M - 4, size: ts(t, TYPE.kicker), font: bold,
    color: onFeature ? titleCol : accent,
  });

  const sidebarW = 210;
  const planW    = W - sidebarW - M * 2 - 24;
  const planTop  = H - M - 34;
  const planBot  = M + 8;
  const planH    = planTop - planBot;

  // Priority: AI render > colour-coded render > original plan
  const planSource = project.aiRenderedPlanUrl ?? project.renderedPlanUrl ?? project.planImagePath;

  async function drawPlan(src: string | undefined): Promise<boolean> {
    if (!src) return false;
    try {
      const imgBytes = await loadImageBytes(src);
      if (!imgBytes) return false;
      const pdfImg = await doc.embedPng(imgBytes).catch(() => doc.embedJpg(imgBytes));
      const dims   = pdfImg.scaleToFit(planW, planH);
      const ix     = M + (planW - dims.width) / 2;
      const iy     = planBot + (planH - dims.height) / 2;
      // A light plate behind the plan keeps line drawings readable on dark
      // presets — most uploaded plans are black-on-white.
      if (onFeature) {
        page.drawRectangle({
          x: ix - 10, y: iy - 10, width: dims.width + 20, height: dims.height + 20,
          color: t.white, opacity: 0.96,
        });
      }
      page.drawImage(pdfImg, { x: ix, y: iy, width: dims.width, height: dims.height });
      return true;
    } catch {
      return false;
    }
  }

  const ok = (await drawPlan(planSource)) || (await drawPlan(project.planImagePath));
  if (!ok) {
    page.drawRectangle({ x: M, y: planBot, width: planW, height: planH, color: t.panelOnFeature });
    page.drawText("Floor plan unavailable", {
      x: M + planW / 2 - 70, y: planBot + planH / 2,
      size: ts(t, TYPE.body), font, color: mutedCol,
    });
  }

  // ── Room sidebar ───────────────────────────────────────────────────────
  const rx    = W - M - sidebarW;
  const rooms = project.analysis?.rooms ?? [];

  page.drawText("ROOMS", {
    x: rx, y: H - M - 4, size: ts(t, TYPE.statLabel), font: bold, color: mutedCol,
  });
  page.drawLine({
    start: { x: rx, y: H - M - 16 }, end: { x: W - M, y: H - M - 16 },
    thickness: 0.6, color: t.ruleOnFeature,
  });

  // Reserve room for the total block at the bottom, then fit what we can.
  const listTop = H - M - 40;
  const listBot = M + 54;
  const rowH    = 26;
  const maxRooms = Math.max(1, Math.min(rooms.length, Math.floor((listTop - listBot) / rowH)));

  let roomY = listTop;
  for (let i = 0; i < maxRooms; i++) {
    const room = rooms[i];
    page.drawText(room.name, {
      x: rx, y: roomY, size: ts(t, TYPE.caption), font, color: titleCol,
    });
    if (room.sizeEstimateSqm) {
      const sqmStr = `${room.sizeEstimateSqm} m²`;
      const sqmW   = font.widthOfTextAtSize(sqmStr, ts(t, TYPE.caption));
      page.drawText(sqmStr, {
        x: W - M - sqmW, y: roomY, size: ts(t, TYPE.caption), font, color: mutedCol,
      });
    }
    roomY -= rowH;
  }

  // Be honest when the sidebar can't show everything, rather than silently
  // truncating the list.
  if (rooms.length > maxRooms) {
    page.drawText(`+ ${rooms.length - maxRooms} more`, {
      x: rx, y: roomY + 4, size: ts(t, 9), font, color: mutedCol,
    });
  }

  if (project.analysis?.totalAreaSqm) {
    page.drawLine({
      start: { x: rx, y: M + 42 }, end: { x: W - M, y: M + 42 },
      thickness: 0.6, color: t.ruleOnFeature,
    });
    page.drawText("TOTAL AREA", {
      x: rx, y: M + 26, size: ts(t, 8.5), font, color: mutedCol,
    });
    page.drawText(`${project.analysis.totalAreaSqm} m²`, {
      x: rx, y: M + 4, size: ts(t, 18), font: bold,
      color: readableAccent(accent, t.featureBg, t.onFeature),
    });
  }
}

// ─── 4. Plan strengths slide ──────────────────────────────────────────────────
// Two-column grid of numbered bullets

async function addStrengthsSlide(
  doc: PDFDocument, project: Project, strengths: string[],
  accent: RGB, t: PdfTheme, font: PDFFont, bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  slideBackground(page, t, accent);

  const italic = font;
  const bodyTop = slideHeader(page, {
    kicker: "Plan Strengths",
    headline: "Why this plan works",
  }, t, font, bold, italic, accent);

  // Capped at 5 and set in a single column. Two columns of six 11pt bullets
  // gave the eye no order to read in; a short numbered list does.
  const items = strengths.slice(0, 5);
  const rowH  = Math.min(96, (bodyTop - M - 30) / Math.max(items.length, 1));
  const textW = W - M * 2 - 90;

  items.forEach((text, i) => {
    const y = bodyTop - i * rowH;

    page.drawText(String(i + 1).padStart(2, "0"), {
      x: M, y: y - 20, size: ts(t, TYPE.numeral), font: bold, color: accent, opacity: 0.35,
    });

    const lines = wrapText(text, font, ts(t, 14), textW);
    let lineY = y - 8;
    for (const line of lines.slice(0, 3)) {
      page.drawText(line, { x: M + 78, y: lineY, size: ts(t, 14), font, color: t.ink });
      lineY -= ts(t, 14) + 6;
    }

    if (i < items.length - 1) {
      page.drawLine({
        start: { x: M + 78, y: y - rowH + 26 }, end: { x: W - M, y: y - rowH + 26 },
        thickness: 0.5, color: t.rule,
      });
    }
  });
}

// ─── 5. Moodboard slide ───────────────────────────────────────────────────────
// Full-bleed image, dark gradient overlay, room name + notes at bottom

async function addMoodboardSlide(
  doc: PDFDocument, mb: Moodboard, accent: RGB, t: PdfTheme, font: PDFFont, bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: t.featureBg });

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
    x: M, y: 72, size: 26, font: bold, color: ON_IMAGE,
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
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: t.featureBg });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  // Title bar
  page.drawText("INTERIOR STYLE  ·  OVERALL CONCEPT", {
    x: M, y: H - M - 4, size: 9, font: bold, color: accent,
  });

  // Style name + statement
  const styleName = project.styleProfile?.overallStyle ?? "Modern";
  page.drawText(styleName.toUpperCase(), {
    x: M, y: H - M - 22, size: 20, font: bold, color: ON_IMAGE,
  });
  page.drawText(`"${overall.styleStatement}"`, {
    x: M, y: H - M - 40, size: 10, font: italic, color: ON_IMAGE_MUTED, opacity: 0.7,
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
        x: pos.x + 8, y: pos.y + 7, size: 7, font, color: ON_IMAGE, opacity: 0.8,
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
    page.drawText(tag.toUpperCase(), { x: tx + 8, y: tagY + 6, size: 8, font, color: ON_IMAGE_MUTED });
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
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: t.pageBg });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });

  // Room title
  page.drawRectangle({ x: M, y: H - M - 10, width: 4, height: 14, color: accent });
  page.drawText(rm.roomName.toUpperCase(), {
    x: M + 12, y: H - M - 5, size: 12, font: bold, color: t.ink,
  });
  page.drawLine({
    start: { x: M, y: H - M - 22 },
    end:   { x: W - M, y: H - M - 22 },
    thickness: 0.5, color: t.rule,
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
      x: M, y: H - M - 42, size: 11, font: bold, color: t.ink,
    });
  }
  if (roomDetail?.orientation) {
    page.drawText(roomDetail.orientation, {
      x: M, y: H - M - 58, size: 9, font, color: t.muted,
    });
  }
  if (roomDetail?.notes) {
    page.drawText(roomDetail.notes, {
      x: M, y: H - M - 72, size: 8, font, color: t.muted,
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
          color: t.white, borderColor: t.rule, borderWidth: 0.5 });
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
        color: t.white, borderColor: t.rule, borderWidth: 0.5 });
      page.drawImage(pImg, { x: sx, y: sy, width: dims.width, height: dims.height });
      page.drawText("Full plan reference", { x: sx, y: sy - 14, size: 6.5, font, color: t.muted });
    } catch {
      page.drawRectangle({ x: M, y: planBotY, width: leftW - M - 8, height: planH,
        color: t.panel, borderColor: t.rule, borderWidth: 0.5 });
      page.drawText("PLAN", { x: M + 12, y: planBotY + planH / 2, size: 8, font, color: t.muted });
    }
  }

  // Special features tags — sit between the plan box and the footer
  if (roomDetail?.specialFeatures?.length) {
    let fy = M + FOOTER_H + 24;
    for (const feat of roomDetail.specialFeatures.slice(0, 3)) {
      page.drawText(`· ${feat}`, { x: M, y: fy, size: 8, font, color: t.muted });
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

      page.drawRectangle({ x: ix, y: topY - imgH, width: imgW, height: imgH, color: t.panel });
      drawClippedImage(page, pImg, { x: dx, y: dy, width: dw, height: dh },
        { x: ix, y: topY - imgH, width: imgW, height: imgH });

      // Caption
      page.drawRectangle({ x: ix, y: topY - imgH, width: imgW, height: 18,
        color: rgb(0,0,0), opacity: 0.5 });
      page.drawText((img.caption ?? "").toUpperCase(), {
        x: ix + 6, y: topY - imgH + 5, size: 7, font, color: ON_IMAGE, opacity: 0.85,
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

          page.drawRectangle({ x: rx, y: bottomY, width: rW, height: stripH, color: t.panel });
          drawClippedImage(page, pImg, { x: dx, y: dy, width: dw, height: dh },
            { x: rx, y: bottomY, width: rW, height: stripH });

          page.drawRectangle({ x: rx, y: bottomY, width: rW, height: 20,
            color: rgb(0,0,0), opacity: 0.55 });
          page.drawText((img.caption ?? "").toUpperCase(), {
            x: rx + 8, y: bottomY + 7, size: 7, font, color: ON_IMAGE, opacity: 0.85,
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

/**
 * Standard slide header: small accent kicker, then a large headline, then an
 * optional supporting line.
 *
 * The old `slideTitle` drew a single 10pt label and nothing else, so every
 * slide opened with the same whisper and no hierarchy. Clients had no visual
 * entry point. Returns the y-coordinate where body content may begin.
 */
function slideHeader(
  page: PDFPage,
  opts: {
    kicker: string;
    headline: string;
    subhead?: string;
    onFeature?: boolean;
  },
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont,
  accent: RGB,
): number {
  const onFeature  = opts.onFeature ?? false;
  const headColor  = onFeature ? t.onFeature : t.ink;
  const subColor   = onFeature ? t.onFeatureMuted : t.muted;
  // On dark surfaces a saturated brand accent can fall below contrast; the
  // light body colour reads more reliably for the small kicker.
  const kickColor  = onFeature && isDarkSurface(t.featureBg) ? t.onFeature : accent;

  let y = H - M - 6;

  page.drawText(opts.kicker.toUpperCase(), {
    x: M, y, size: ts(t, TYPE.kicker), font: bold, color: kickColor,
  });

  y -= ts(t, TYPE.headline) + 10;
  page.drawText(opts.headline, {
    x: M, y, size: ts(t, TYPE.headline), font: bold, color: headColor,
  });

  if (opts.subhead) {
    y -= ts(t, TYPE.subhead) + 10;
    const lines = wrapText(opts.subhead, italic, ts(t, TYPE.subhead), W - M * 2 - 220);
    for (const line of lines.slice(0, 2)) {
      page.drawText(line, { x: M, y, size: ts(t, TYPE.subhead), font: italic, color: subColor });
      y -= ts(t, TYPE.subhead) + 4;
    }
  }

  return y - 26;
}

/** Rough luminance test — decides whether a surface needs light text. */
function isDarkSurface(c: RGB): boolean {
  return 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue < 0.5;
}

/** WCAG relative luminance. */
function luminance(c: RGB): number {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.red) + 0.7152 * f(c.green) + 0.0722 * f(c.blue);
}

/** WCAG contrast ratio between two colours (1 = identical, 21 = black/white). */
function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Use the firm's accent only where it's actually legible against the surface,
 * otherwise fall back to a colour that is.
 *
 * The default accent is graphite (#2d2b27). Drawn on the near-black feature
 * surface (#1e1c1a) that's a contrast ratio of about 1.1 — invisible. This bit
 * the page footer and the "TOTAL AREA" figure on the floor plan slide, both of
 * which simply disappeared for any firm on the default accent.
 */
function readableAccent(accent: RGB, bg: RGB, fallback: RGB): RGB {
  return contrastRatio(accent, bg) >= 3 ? accent : fallback;
}

/**
 * Paint the slide background + optional top accent bar.
 *
 * Also records whether this slide uses the feature surface, so the footer pass
 * at the end of buildProjectPdf can pick a colour that actually contrasts.
 * pdf-lib gives no way to read a page's background back, hence the tag.
 */
const FEATURE_PAGES = new WeakSet<PDFPage>();

function slideBackground(page: PDFPage, t: PdfTheme, accent: RGB, feature = false) {
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: feature ? t.featureBg : t.pageBg });
  if (t.accentBar) {
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });
  }
  if (feature) FEATURE_PAGES.add(page);
}

function addSlideFooter(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  pageNum: number,
  total: number,
  firm: FirmProfile | null,
  accent: RGB,
  t: PdfTheme,
  onFeature: boolean,
) {
  // The footer must be told which surface it landed on. Drawing the firm's
  // accent on a near-black feature slide renders it effectively invisible —
  // a graphite accent on a #1e1c1a background is almost the same colour.
  const col = onFeature
    ? (isDarkSurface(t.featureBg) ? t.onFeatureMuted : t.muted)
    : (isDarkSurface(t.pageBg) ? t.muted : accent);

  const firmName = firm?.name ?? "Architecture Studio";
  const label    = `${pageNum} / ${total}`;
  const labelW   = font.widthOfTextAtSize(label, ts(t, TYPE.footer));

  page.drawText(firmName, {
    x: M, y: M - 6, size: ts(t, TYPE.footer), font: bold, color: col, opacity: 0.85,
  });
  page.drawText(label, {
    x: W - M - labelW, y: M - 6, size: ts(t, TYPE.footer), font, color: col, opacity: 0.85,
  });
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
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont
) {
  const rooms = project.analysis?.rooms ?? [];
  if (rooms.length === 0) return;

  // Six room cards per slide (2 columns × 3 rows), paginating across as many
  // slides as the home needs.
  //
  // The previous version tried to cram EVERY room onto a single slide in two
  // dense columns and `break`ed out of the loop when it ran out of vertical
  // space — so any room past roughly the tenth was silently dropped from the
  // deck. Cards also let the narrative breathe at readable body size.
  const PER_SLIDE = 6;
  const COLS = 2;
  const ROWS = 3;

  // ── Plan snippets ──────────────────────────────────────────────────────
  //
  // Each card shows a crop of the floor plan so the client can see WHICH
  // space is being described, rather than matching room names to a plan two
  // slides back.
  //
  // Cropped here in pdf-lib via a clip rect rather than through lib/planCrop.ts
  // (sharp): the image is embedded once and reused across every card, so
  // there's no per-room fetch, no extra Supabase storage, and no sharp
  // dependency on Vercel.
  //
  // Crops come from planImagePath — the exact image the vision pass measured
  // against. NOT renderedPlanUrl: FloodFillRenderer appends a legend strip
  // (`canvas.height = h + legendH`), so the rendered plan is taller than the
  // original and normalised y-coordinates would land in the wrong place.
  let planImg: PDFImage | null = null;
  const anyBoxes = rooms.some((r) => r.boundingBox);
  if (anyBoxes && project.planImagePath) {
    try {
      const bytes = await loadImageBytes(project.planImagePath);
      if (bytes) {
        planImg = await doc.embedPng(bytes).catch(() => doc.embedJpg(bytes));
      }
    } catch (err) {
      console.warn("[pdf] Plan snippet image unavailable (non-fatal):", String(err));
    }
  }

  const brief = project.plotInfo;
  const subtitle = brief?.familyDetails
    ? `Designed for ${brief.familyDetails}${brief.priorities ? ` — prioritising ${brief.priorities.toLowerCase()}` : ""}.`
    : "Every room has been designed with purpose.";

  const totalSlides = Math.ceil(rooms.length / PER_SLIDE);

  for (let s = 0; s < totalSlides; s++) {
    const slice = rooms.slice(s * PER_SLIDE, (s + 1) * PER_SLIDE);
    const page = doc.addPage([W, H]);
    slideBackground(page, t, accent, true);

    const onFeature = isDarkSurface(t.featureBg);

    const bodyTop = slideHeader(page, {
      kicker: totalSlides > 1 ? `A Walk Through Your Home · ${s + 1} of ${totalSlides}` : "A Walk Through Your Home",
      headline: s === 0 ? "Room by room" : "Room by room, continued",
      subhead: s === 0 ? subtitle : undefined,
      onFeature: true,
    }, t, font, bold, italic, accent);

    const gapX  = 28;
    const gapY  = 18;
    const cardW = (W - M * 2 - gapX) / COLS;
    const availH = bodyTop - M - 24;
    const cardH = Math.min(150, (availH - gapY * (ROWS - 1)) / ROWS);

    slice.forEach((room, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = M + col * (cardW + gapX);
      const y = bodyTop - row * (cardH + gapY) - cardH;

      if (t.filledCards) {
        page.drawRectangle({ x, y, width: cardW, height: cardH, color: t.panelOnFeature });
      }
      page.drawRectangle({ x, y, width: 3, height: cardH, color: accent });

      const padX = 18;

      // Snippet on the left, text to its right. Rooms the vision pass didn't
      // locate simply get the full card width — better than a placeholder
      // tile pretending we know where the room is.
      const box = room.boundingBox;
      let textX = x + padX;
      let textW = cardW - padX * 2;

      if (planImg && box) {
        const thumbSize = cardH - 24;
        const tx = x + padX;
        const ty = y + 12;

        drawPlanSnippet(page, planImg, box, { x: tx, y: ty, width: thumbSize, height: thumbSize }, t, accent);

        textX = tx + thumbSize + 16;
        textW = x + cardW - padX - textX;
      }

      let cy = y + cardH - 26;

      page.drawText(room.name.toUpperCase(), {
        x: textX, y: cy,
        size: ts(t, TYPE.cardTitle), font: bold,
        color: onFeature ? t.onFeature : t.ink,
      });

      if (room.sizeEstimateSqm) {
        const areaStr = `${room.sizeEstimateSqm} m²`;
        const aW = font.widthOfTextAtSize(areaStr, ts(t, TYPE.caption));
        page.drawText(areaStr, {
          x: textX + textW - aW, y: cy + 2,
          size: ts(t, TYPE.caption), font,
          color: onFeature ? t.onFeatureMuted : t.muted,
        });
      }

      cy -= 18;
      page.drawLine({
        start: { x: textX, y: cy }, end: { x: textX + textW, y: cy },
        thickness: 0.5, color: t.ruleOnFeature,
      });
      cy -= ts(t, TYPE.body) + 6;

      const desc = project.roomNarratives?.[room.name] ?? buildRoomNarrative(room, project.plotInfo);
      const maxLines = Math.max(1, Math.floor((cy - y - 12) / (ts(t, TYPE.body) + 4)) + 1);
      const lines = wrapText(desc, font, ts(t, TYPE.body), textW);

      lines.slice(0, maxLines).forEach((line, li) => {
        // If the narrative is longer than the card, ellipsise the last visible
        // line rather than cutting mid-sentence with no signal.
        const isLast = li === maxLines - 1 && lines.length > maxLines;
        page.drawText(isLast ? `${line}…` : line, {
          x: textX, y: cy,
          size: ts(t, TYPE.body), font,
          color: onFeature ? t.onFeature : t.ink,
          opacity: onFeature ? 0.88 : 1,
        });
        cy -= ts(t, TYPE.body) + 4;
      });
    });
  }
}

/**
 * Draw the region of `img` described by a normalised bounding box, fitted into
 * `thumb`, clipped so nothing spills outside.
 *
 * Bounding boxes are normalised 0-1 with origin at TOP-left (see
 * RoomBoundingBox in types/index.ts); PDF user space has its origin at
 * BOTTOM-left, hence the y-flip below.
 */
function drawPlanSnippet(
  page: PDFPage,
  img: PDFImage,
  box: { x: number; y: number; width: number; height: number },
  thumb: { x: number; y: number; width: number; height: number },
  t: PdfTheme,
  accent: RGB,
) {
  // Clamp: the vision pass occasionally returns values slightly outside 0-1,
  // and a zero/negative extent would make the scale below divide by zero.
  const bx = Math.min(Math.max(box.x, 0), 1);
  const by = Math.min(Math.max(box.y, 0), 1);
  const bw = Math.min(Math.max(box.width, 0.01), 1 - bx);
  const bh = Math.min(Math.max(box.height, 0.01), 1 - by);

  // A little context around the room helps the client locate it on the plan;
  // a tight crop of four walls is hard to place. Kept modest because fitting a
  // non-square region into a square thumb already reveals extra along the
  // short axis.
  const PAD = 0.08;
  const px = Math.max(0, bx - bw * PAD);
  const py = Math.max(0, by - bh * PAD);
  const pw = Math.min(1 - px, bw * (1 + PAD * 2));
  const ph = Math.min(1 - py, bh * (1 + PAD * 2));

  // Plans are line drawings on white — give them a plate so they read on the
  // dark feature surface.
  page.drawRectangle({
    x: thumb.x, y: thumb.y, width: thumb.width, height: thumb.height,
    color: t.white,
  });

  // Fit the padded region inside the thumb (contain, not cover — cropping a
  // crop would defeat the point).
  const scale = Math.min(
    thumb.width / (pw * img.width),
    thumb.height / (ph * img.height),
  );
  const dw = img.width * scale;
  const dh = img.height * scale;

  // Place the image so the region's centre lands on the thumb's centre.
  const dx = thumb.x + thumb.width / 2 - (px + pw / 2) * dw;
  const dy = thumb.y + thumb.height / 2 - (1 - py - ph / 2) * dh;

  drawClippedImage(page, img, { x: dx, y: dy, width: dw, height: dh }, thumb);

  // Mark the room. The crop deliberately includes neighbouring spaces for
  // context, and on a real plan — black linework on white — the client can't
  // otherwise tell which one we mean.
  //
  // A wash plus an outline, not an outline alone: a thin stroke in the firm's
  // accent looks like more plan linework, and the default accent is graphite,
  // which is very nearly the same colour as the drawing itself. An area wash
  // reads as a highlight regardless of how dark or desaturated the accent is.
  page.pushOperators(
    pushGraphicsState(),
    rectangle(thumb.x, thumb.y, thumb.width, thumb.height),
    clip(),
    endPath(),
  );
  const mark = {
    x: dx + bx * dw,
    y: dy + (1 - by - bh) * dh,
    width: bw * dw,
    height: bh * dh,
  };
  page.drawRectangle({ ...mark, color: accent, opacity: 0.22 });
  page.drawRectangle({ ...mark, borderColor: accent, borderWidth: 1.5 });
  page.pushOperators(popGraphicsState());

  // Hairline keeps the white plate from bleeding into the card on light themes.
  page.drawRectangle({
    x: thumb.x, y: thumb.y, width: thumb.width, height: thumb.height,
    borderColor: t.ruleOnFeature, borderWidth: 0.5,
  });
}

// buildRoomNarrative moved to lib/narrative.ts (pure logic, no server-only
// imports) so client components can import it without pulling fs/sharp/
// pdf-lib into the browser bundle. Re-exported below so existing external
// call sites (e.g. app/api/export/route.ts) that import it from "@/lib/pdf"
// keep working unchanged.
export { buildRoomNarrative } from "@/lib/narrative";


// ─── Concept Presentation: Spatial Highlights slide ───────────────────────────
//
// Lifestyle-focused insights about the plan — not just numbers, but what
// those numbers mean for daily living.

async function addSpatialHighlightsSlide(
  doc: PDFDocument,
  project: Project,
  accent: RGB,
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont
) {
  const rooms = project.analysis?.rooms ?? [];
  if (rooms.length === 0) return;

  const page = doc.addPage([W, H]);
  slideBackground(page, t, accent);

  // Personalized subtitle
  const brief = project.plotInfo;
  const highlightSub = brief?.lifestyle
    ? `How this home supports your lifestyle — ${brief.lifestyle.toLowerCase()}.`
    : "The key design decisions that make this home work for everyday life.";

  const bodyTop = slideHeader(page, {
    kicker: "Why This Plan Works",
    headline: "Built around how you live",
    subhead: highlightSub,
  }, t, font, bold, italic, accent);

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

  // Client-context insights from the brief
  const lifestyle = project.plotInfo?.lifestyle?.toLowerCase() ?? "";
  const priorities = project.plotInfo?.priorities?.toLowerCase() ?? "";

  if (lifestyle.includes("work from home") || lifestyle.includes("wfh")) {
    const study = rooms.find(r => r.name.toLowerCase().includes("study") || r.name.toLowerCase().includes("office"));
    if (study) {
      insights.push({ icon: "06", title: "Work-From-Home Ready",
        detail: `Dedicated ${study.name} positioned for focus — away from the social zones and kitchen noise.` });
    }
  }

  if (lifestyle.includes("cook") || lifestyle.includes("kitchen")) {
    insights.push({ icon: "06", title: "Designed for a Cook",
      detail: "Kitchen workflow optimised with counter space and direct dining access — cooking is a joy, not a chore." });
  }

  if (priorities.includes("privacy")) {
    insights.push({ icon: "06", title: "Privacy by Design",
      detail: "Bedrooms are zoned away from social spaces — guests and family members don't cross paths." });
  }

  if (priorities.includes("light") || priorities.includes("ventilation")) {
    insights.push({ icon: "06", title: "Natural Light Priority",
      detail: "Room orientations maximise daylight — reducing dependence on artificial lighting during the day." });
  }

  if (project.plotInfo?.familyDetails?.toLowerCase().includes("elderly") || 
      project.plotInfo?.familyDetails?.toLowerCase().includes("parent")) {
    const hasLift = rooms.some(r => r.name.toLowerCase().includes("lift"));
    insights.push({ icon: "06", title: "Elder-Friendly",
      detail: hasLift ? "Lift provision ensures accessibility for elderly family members across floors."
        : "Ground-floor bedroom suite can serve elderly family members without stairs." });
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

  // Render insights as two-column cards. Four is the cap: a client will read
  // four reasons, and skim ten.
  //
  // De-duplicate first — several branches above emit icon "06", and lifestyle
  // and priorities can independently produce near-identical cards.
  const seen = new Set<string>();
  const unique = insights.filter((ins) => {
    const key = ins.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const shown = unique.slice(0, 4);
  const COLS  = 2;
  const gapX  = 28;
  const gapY  = 22;
  const cardW = (W - M * 2 - gapX) / COLS;
  const rows  = Math.ceil(shown.length / COLS);
  const cardH = Math.min(150, (bodyTop - M - 20 - gapY * (rows - 1)) / Math.max(rows, 1));

  shown.forEach((insight, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = M + col * (cardW + gapX);
    const y = bodyTop - row * (cardH + gapY) - cardH;

    if (t.filledCards) {
      page.drawRectangle({ x, y, width: cardW, height: cardH, color: t.panel });
    } else {
      page.drawRectangle({
        x, y, width: cardW, height: cardH,
        borderColor: t.rule, borderWidth: 0.75,
      });
    }

    const padX = 22;

    // Numeral, sized as a quiet index rather than an icon.
    page.drawText(String(i + 1).padStart(2, "0"), {
      x: x + padX, y: y + cardH - 34,
      size: ts(t, 22), font: bold, color: accent, opacity: 0.4,
    });

    const titleLines = wrapText(insight.title, bold, ts(t, TYPE.cardTitle), cardW - padX * 2 - 46);
    let ty = y + cardH - 30;
    titleLines.slice(0, 2).forEach((line) => {
      page.drawText(line, {
        x: x + padX + 46, y: ty,
        size: ts(t, TYPE.cardTitle), font: bold, color: t.ink,
      });
      ty -= ts(t, TYPE.cardTitle) + 3;
    });

    let dy = ty - 12;
    const maxLines = Math.max(1, Math.floor((dy - y - 14) / (ts(t, TYPE.body) + 4)) + 1);
    wrapText(insight.detail, font, ts(t, TYPE.body), cardW - padX * 2)
      .slice(0, maxLines)
      .forEach((line) => {
        page.drawText(line, {
          x: x + padX, y: dy, size: ts(t, TYPE.body), font, color: t.muted,
        });
        dy -= ts(t, TYPE.body) + 4;
      });
  });
}

// ─── Closing slide ────────────────────────────────────────────────────────────
//
// Answers "what do I do next?". The deck previously just stopped after the
// last content slide, leaving the client with no call to action.

async function addThankYouSlide(
  doc: PDFDocument,
  project: Project,
  firm: FirmProfile | null,
  accent: RGB,
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont,
) {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: t.featureBg });
  if (t.accentBar) {
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });
  }

  const onFeature = isDarkSurface(t.featureBg);
  const titleCol  = onFeature ? t.onFeature : t.ink;
  const mutedCol  = onFeature ? t.onFeatureMuted : t.muted;

  page.drawText("THANK YOU", {
    x: M, y: H - M - 4, size: ts(t, TYPE.kicker), font: bold,
    color: onFeature ? t.onFeature : accent,
  });

  const headline = "Let's talk about your home";
  page.drawText(headline, {
    x: M, y: H * 0.60, size: ts(t, 42), font: bold, color: titleCol,
  });

  const sub = `We'd love to hear your thoughts on this concept for ${project.name}.`;
  page.drawText(sub, {
    x: M, y: H * 0.60 - 34, size: ts(t, TYPE.subhead), font: italic, color: mutedCol,
  });

  page.drawLine({
    start: { x: M, y: H * 0.60 - 60 }, end: { x: M + 120, y: H * 0.60 - 60 },
    thickness: 2, color: accent,
  });

  // Contact block — phone first: in practice clients call.
  let cy = H * 0.60 - 100;
  const contacts: { label: string; value: string }[] = [];
  if (firm?.phone)   contacts.push({ label: "CALL US",   value: firm.phone });
  if (firm?.email)   contacts.push({ label: "EMAIL",     value: firm.email });
  if (firm?.website) contacts.push({ label: "WEBSITE",   value: firm.website });

  for (const c of contacts) {
    page.drawText(c.label, { x: M, y: cy, size: ts(t, 8.5), font, color: mutedCol });
    page.drawText(c.value, { x: M, y: cy - 20, size: ts(t, 17), font: bold, color: titleCol });
    cy -= 54;
  }

  // Firm lockup — bottom right
  const firmName = (firm?.name ?? project.firmName).toUpperCase();
  const fnW = bold.widthOfTextAtSize(firmName, ts(t, 12));
  page.drawText(firmName, {
    x: W - M - fnW, y: M + 4, size: ts(t, 12), font: bold, color: titleCol,
  });
  if (firm?.tagline) {
    const tgW = font.widthOfTextAtSize(firm.tagline, ts(t, TYPE.caption));
    page.drawText(firm.tagline, {
      x: W - M - tgW, y: M - 12, size: ts(t, TYPE.caption), font, color: mutedCol,
    });
  }

  // QR to the live, always-current version of this presentation.
  if (project.shareToken && project.shareEnabled !== false) {
    try {
      const { generateQrMatrix, drawQrOnPage } = await import("@/lib/qr");
      const shareUrl = `${process.env.APP_URL ?? "https://archpresent.vercel.app"}/share/${project.shareToken}`;
      const qrMatrix = generateQrMatrix(shareUrl);
      const qrSize = 3.0;
      const qrTotal = qrMatrix.length * qrSize;
      const qrX = W - M - qrTotal;
      const qrY = H * 0.42;

      page.drawRectangle({
        x: qrX - 10, y: qrY - 10, width: qrTotal + 20, height: qrTotal + 20, color: t.white,
      });
      drawQrOnPage(page, qrMatrix, qrX, qrY, qrSize, t.featureBg, t.white);

      const lbl = "VIEW THIS PRESENTATION ONLINE";
      page.drawText(lbl, {
        x: qrX + qrTotal / 2 - font.widthOfTextAtSize(lbl, ts(t, 8)) / 2,
        y: qrY - 24, size: ts(t, 8), font, color: mutedCol,
      });
    } catch (err) {
      console.warn("[pdf] QR code generation failed (non-fatal):", err);
    }
  }
}

// ─── Concept: Vastu Compliance slide ──────────────────────────────────────────

async function addVastuSlide(
  doc: PDFDocument,
  project: Project,
  accent: RGB,
  t: PdfTheme,
  font: PDFFont,
  bold: PDFFont,
  italic: PDFFont
) {
  const rooms = project.analysis?.rooms ?? [];
  const facing = (project.plotInfo?.facing ?? "").toLowerCase();
  if (!facing || rooms.length === 0) return;

  const page = doc.addPage([W, H]);
  slideBackground(page, t, accent);

  const bodyTop = slideHeader(page, {
    kicker: "Vastu Analysis",
    headline: "Vastu alignment",
    subhead: "How this plan aligns with Vastu Shastra principles.",
  }, t, font, bold, italic, accent);

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

  // ── Score ring — right panel ───────────────────────────────────────────
  const passCount = results.filter(r => r.pass).length;
  const score = Math.round((passCount / results.length) * 100);

  const ringX = W - M - 110;
  const ringY = H * 0.50;
  const ringR = 92;

  page.drawCircle({ x: ringX, y: ringY, size: ringR, color: t.panel });
  page.drawCircle({
    x: ringX, y: ringY, size: ringR,
    borderColor: accent, borderWidth: 4, opacity: 1,
  });

  const scoreStr = `${score}%`;
  page.drawText(scoreStr, {
    x: ringX - bold.widthOfTextAtSize(scoreStr, ts(t, 46)) / 2,
    y: ringY - 8, size: ts(t, 46), font: bold, color: accent,
  });
  const scoreLbl = "VASTU SCORE";
  page.drawText(scoreLbl, {
    x: ringX - font.widthOfTextAtSize(scoreLbl, ts(t, 9)) / 2,
    y: ringY - 34, size: ts(t, 9), font, color: t.muted,
  });
  const passLbl = `${passCount} of ${results.length} checks aligned`;
  page.drawText(passLbl, {
    x: ringX - font.widthOfTextAtSize(passLbl, ts(t, TYPE.caption)) / 2,
    y: ringY - ringR - 26, size: ts(t, TYPE.caption), font, color: t.muted,
  });

  // ── Results list — left ────────────────────────────────────────────────
  const listW = W - M * 2 - 250;
  const shown = results.slice(0, 7);
  const rowH  = Math.min(46, (bodyTop - M - 30) / Math.max(shown.length, 1));

  shown.forEach((r, i) => {
    const y = bodyTop - i * rowH;
    const col = r.pass ? PASS : FAIL;

    // Status pill — a filled dot plus a word, so it survives greyscale
    // printing and colour-blind readers rather than relying on hue alone.
    page.drawCircle({ x: M + 6, y: y + 4, size: 5, color: col });
    page.drawText(r.pass ? "ALIGNED" : "REVIEW", {
      x: M + 18, y: y, size: ts(t, 9), font: bold, color: col,
    });

    page.drawText(r.rule.toUpperCase(), {
      x: M + 96, y: y, size: ts(t, TYPE.caption + 1), font: bold, color: t.ink,
    });

    page.drawText(`Ideal ${r.ideal}  ·  Actual ${r.actual}`, {
      x: M + 96, y: y - 16, size: ts(t, TYPE.caption), font, color: t.muted,
    });

    if (i < shown.length - 1) {
      page.drawLine({
        start: { x: M, y: y - rowH + 18 }, end: { x: M + listW, y: y - rowH + 18 },
        thickness: 0.5, color: t.rule,
      });
    }
  });

  // Sits above the footer band (which the orchestrator draws at y = M - 6).
  page.drawText("Vastu analysis is indicative, based on room orientation from the AI plan analysis.", {
    x: M, y: M + 18, size: ts(t, 9), font: italic, color: t.muted,
  });
}
