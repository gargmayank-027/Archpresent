/**
 * lib/pdfTheme.ts
 *
 * Visual presets for the exported PDF deck.
 *
 * The `presentationTheme` field already existed on Project and the Export
 * screen already let firms pick between Classic / Dark / Minimal / Warm —
 * but lib/pdf.ts never read it, so the choice had no effect. This module
 * defines what each preset actually means, and lib/pdf.ts now renders
 * against it.
 *
 * A preset controls SURFACE and TYPOGRAPHY only. The firm's accent colour
 * (from their profile) is layered on top of whichever preset is chosen, so
 * branding survives a theme switch.
 *
 * NOTE: no server-only imports here — pdf-lib's `rgb`/`RGB` are pure value
 * helpers, safe to import from client components that want to preview a
 * swatch.
 */

import { rgb, RGB } from "pdf-lib";
import type { PdfThemeId } from "@/lib/pdfThemeMeta";

export type { PdfThemeId } from "@/lib/pdfThemeMeta";

export interface PdfTheme {
  id: PdfThemeId;
  label: string;
  /** One-line description shown next to the picker on the Export screen. */
  description: string;

  // ── Surfaces ──────────────────────────────────────────────────────────
  /** Background for standard content slides. */
  pageBg: RGB;
  /** Background for feature slides (floor plan, walkthrough, highlights). */
  featureBg: RGB;
  /** Subtle fill for cards / stat blocks sitting on pageBg. */
  panel: RGB;
  /** Subtle fill for cards sitting on featureBg. */
  panelOnFeature: RGB;

  // ── Text ──────────────────────────────────────────────────────────────
  /** Primary text on pageBg. */
  ink: RGB;
  /** Secondary text on pageBg. */
  muted: RGB;
  /** Primary text on featureBg. */
  onFeature: RGB;
  /** Secondary text on featureBg. */
  onFeatureMuted: RGB;

  // ── Lines ─────────────────────────────────────────────────────────────
  rule: RGB;
  ruleOnFeature: RGB;

  white: RGB;

  // ── Treatment ─────────────────────────────────────────────────────────
  /** Draw the 6pt accent bar across the top of each slide. */
  accentBar: boolean;
  /** Fill card backgrounds, vs. relying on hairline rules alone. */
  filledCards: boolean;
  /** Cover layout treatment. */
  coverStyle: "split" | "band" | "quiet";
  /**
   * Global type-scale multiplier. Minimal runs slightly larger and airier
   * because it has less colour doing the work.
   */
  scale: number;
}

const THEMES: Record<PdfThemeId, PdfTheme> = {
  // ── Classic — warm editorial, the default ────────────────────────────
  classic: {
    id: "classic",
    label: "Classic",
    description: "Warm off-white, editorial. Safe for any client.",
    pageBg:         rgb(0.97, 0.96, 0.94),
    featureBg:      rgb(0.12, 0.11, 0.10),
    panel:          rgb(0.93, 0.92, 0.90),
    panelOnFeature: rgb(0.18, 0.17, 0.16),
    ink:            rgb(0.10, 0.10, 0.10),
    muted:          rgb(0.44, 0.43, 0.41),
    onFeature:      rgb(0.96, 0.95, 0.93),
    onFeatureMuted: rgb(0.65, 0.64, 0.62),
    rule:           rgb(0.80, 0.78, 0.74),
    ruleOnFeature:  rgb(0.30, 0.29, 0.28),
    white:          rgb(1, 1, 1),
    accentBar:      true,
    filledCards:    true,
    coverStyle:     "split",
    scale:          1.0,
  },

  // ── Dark — near-black throughout, dramatic ───────────────────────────
  dark: {
    id: "dark",
    label: "Dark",
    description: "Near-black throughout. Renders and plans pop.",
    pageBg:         rgb(0.11, 0.11, 0.12),
    featureBg:      rgb(0.07, 0.07, 0.08),
    panel:          rgb(0.17, 0.17, 0.18),
    panelOnFeature: rgb(0.14, 0.14, 0.15),
    ink:            rgb(0.96, 0.96, 0.95),
    muted:          rgb(0.60, 0.60, 0.60),
    onFeature:      rgb(0.96, 0.96, 0.95),
    onFeatureMuted: rgb(0.58, 0.58, 0.58),
    rule:           rgb(0.28, 0.28, 0.29),
    ruleOnFeature:  rgb(0.24, 0.24, 0.25),
    white:          rgb(1, 1, 1),
    accentBar:      true,
    filledCards:    true,
    coverStyle:     "band",
    scale:          1.0,
  },

  // ── Minimal — pure white, hairlines, maximum restraint ───────────────
  minimal: {
    id: "minimal",
    label: "Minimal",
    description: "Pure white, hairline rules, lots of air.",
    pageBg:         rgb(1, 1, 1),
    featureBg:      rgb(0.98, 0.98, 0.98),
    panel:          rgb(0.97, 0.97, 0.97),
    panelOnFeature: rgb(1, 1, 1),
    ink:            rgb(0.08, 0.08, 0.08),
    muted:          rgb(0.52, 0.52, 0.52),
    onFeature:      rgb(0.08, 0.08, 0.08),
    onFeatureMuted: rgb(0.52, 0.52, 0.52),
    rule:           rgb(0.88, 0.88, 0.88),
    ruleOnFeature:  rgb(0.90, 0.90, 0.90),
    white:          rgb(1, 1, 1),
    accentBar:      false,
    filledCards:    false,
    coverStyle:     "quiet",
    scale:          1.05,
  },

  // ── Warm — cream and sand, softer and more residential ───────────────
  warm: {
    id: "warm",
    label: "Warm",
    description: "Cream and sand. Softer, more residential.",
    pageBg:         rgb(0.96, 0.94, 0.89),
    featureBg:      rgb(0.20, 0.16, 0.13),
    panel:          rgb(0.92, 0.89, 0.83),
    panelOnFeature: rgb(0.26, 0.21, 0.17),
    ink:            rgb(0.16, 0.13, 0.11),
    muted:          rgb(0.47, 0.42, 0.37),
    onFeature:      rgb(0.96, 0.93, 0.88),
    onFeatureMuted: rgb(0.70, 0.65, 0.58),
    rule:           rgb(0.80, 0.75, 0.67),
    ruleOnFeature:  rgb(0.36, 0.30, 0.25),
    white:          rgb(1, 1, 1),
    accentBar:      true,
    filledCards:    true,
    coverStyle:     "split",
    scale:          1.0,
  },
};

/** Resolve a theme by id, falling back to Classic for unknown/missing ids. */
export function getPdfTheme(id?: string | null): PdfTheme {
  return THEMES[(id ?? "classic") as PdfThemeId] ?? THEMES.classic;
}

// The picker on the Export screen reads lib/pdfThemeMeta.ts instead of this
// module — importing anything from here pulls all of pdf-lib into the client
// bundle, since `rgb()` runs at module scope.

/**
 * Type scale (points, at scale = 1.0).
 *
 * The previous deck set body copy at 8.5pt and footers at 6.5pt on a
 * 1190pt-wide slide — roughly 4pt on A4, which is why clients struggled to
 * read it. These sizes are tuned so the deck stays legible projected in a
 * meeting room and on a phone screen.
 */
export const TYPE = {
  kicker:    11,   // small caps slide label
  headline:  34,   // slide headline
  subhead:   15,   // supporting line under the headline
  statValue: 30,   // big number in a stat block
  statLabel: 9.5,  // label under a stat
  cardTitle: 15,   // room / insight card title
  body:      12.5, // narrative + bullet copy
  caption:   10,   // captions, area tags
  footer:    9,    // page footer
  numeral:   30,   // oversized list numerals
} as const;

/** Apply a theme's scale multiplier to a base type size. */
export function ts(theme: PdfTheme, size: number): number {
  return Math.round(size * theme.scale * 10) / 10;
}
