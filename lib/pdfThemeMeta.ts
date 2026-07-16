/**
 * lib/pdfThemeMeta.ts
 *
 * Picker metadata for the PDF style presets — id, label, description only.
 *
 * Deliberately separate from lib/pdfTheme.ts: that module calls pdf-lib's
 * `rgb()` at module scope, so importing anything from it drags all of pdf-lib
 * (~400KB) into whatever bundle touches it. The Export screen only needs the
 * labels, so it imports this instead. Same reasoning as lib/narrative.ts.
 */

export type PdfThemeId = "classic" | "dark" | "minimal" | "warm";

export interface PdfThemeMeta {
  id: PdfThemeId;
  label: string;
  description: string;
}

export const PDF_THEME_META: PdfThemeMeta[] = [
  { id: "classic", label: "Classic", description: "Warm off-white, editorial. Safe for any client." },
  { id: "dark",    label: "Dark",    description: "Near-black throughout. Renders and plans pop." },
  { id: "minimal", label: "Minimal", description: "Pure white, hairline rules, lots of air." },
  { id: "warm",    label: "Warm",    description: "Cream and sand. Softer, more residential." },
];
