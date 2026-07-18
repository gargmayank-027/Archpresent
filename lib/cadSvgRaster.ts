/**
 * lib/cadSvgRaster.ts
 *
 * Rasterizes a CAD-rendered SVG (from renderer_service) to PNG at a
 * controlled, predictable resolution — regardless of the building's
 * real-world physical size.
 *
 * Why this exists: renderer_service/app/services/svg_renderer.py
 * declares the SVG's width/height in real millimeters (e.g. a large
 * house can easily be 20,000+ mm across). Handing that SVG straight to
 * `sharp()` with no density control means it rasterizes at an implied
 * ~1 pixel per mm, which for a real building produced 500+ million
 * declared pixels — more than double Sharp's built-in decompression-
 * bomb safety limit (~268 million), causing every render of anything
 * but a small test fixture to fail with "Input image exceeds pixel
 * limit". This computes an explicit `density` (DPI) from the SVG's own
 * declared physical size so the OUTPUT is always capped at a sane
 * target resolution, independent of how large the actual building is.
 */

const MM_PER_INCH = 25.4;
const DEFAULT_TARGET_LONG_EDGE_PX = 2400; // crisp enough to view/print, small enough to never hit the pixel limit
const FALLBACK_DENSITY = 96; // used only if the SVG's mm dimensions can't be parsed

function parseSvgSizeMm(svg: string): { widthMm: number; heightMm: number } | null {
  // Matches width="1234mm" height="5678mm" as emitted by svg_renderer.py.
  const match = svg.match(/width="([\d.]+)mm"\s+height="([\d.]+)mm"/);
  if (!match) return null;
  const widthMm = parseFloat(match[1]);
  const heightMm = parseFloat(match[2]);
  if (!isFinite(widthMm) || !isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) return null;
  return { widthMm, heightMm };
}

/**
 * Rasterizes the given CAD SVG string to a PNG buffer, targeting
 * `targetLongEdgePx` on whichever dimension (width or height) is
 * larger — so a long, narrow plan and a square plan both come out at a
 * reasonable, comparable resolution.
 */
export async function rasterizeCadSvgToPng(
  svg: string,
  targetLongEdgePx: number = DEFAULT_TARGET_LONG_EDGE_PX
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  const size = parseSvgSizeMm(svg);
  let density = FALLBACK_DENSITY;
  if (size) {
    const longEdgeMm = Math.max(size.widthMm, size.heightMm);
    const longEdgeInches = longEdgeMm / MM_PER_INCH;
    density = targetLongEdgePx / longEdgeInches;
    // Guard against pathological inputs (a near-zero-size or corrupt
    // SVG producing an absurd density) — clamp to a sane range rather
    // than letting a bad computed value make things worse than the
    // fallback would have.
    density = Math.max(1, Math.min(density, 2400));
  }

  return sharp(Buffer.from(svg), {
    density,
    // Belt-and-suspenders: even with a correctly computed density this
    // should never approach the default limit, but a bug in the density
    // calculation should degrade gracefully (large output), not throw.
    limitInputPixels: false,
  })
    .png()
    .toBuffer();
}
