/**
 * lib/pdfRaster.ts
 *
 * Rasterises PDF pages to PNG buffers using pdfjs-dist + @napi-rs/canvas
 * instead of sharp.
 *
 * WHY NOT SHARP: sharp's PDF support depends on the underlying libvips
 * being compiled with a PDF codec (PDFium or poppler). The prebuilt sharp
 * binaries pulled in by `npm install` on Vercel do NOT include one — sharp
 * fails on every PDF with "Input buffer contains unsupported image format",
 * regardless of whether the PDF itself is valid. There's no config fix for
 * this on Vercel: serverless functions can't install a system libvips with
 * PDF support, so this isn't an environment misconfiguration, it's sharp
 * being the wrong tool for this specific job in this specific environment.
 *
 * pdfjs-dist parses PDFs in pure JS (Mozilla's PDF.js — no native PDF
 * codec needed at all), and @napi-rs/canvas provides the Canvas 2D surface
 * to render into via prebuilt N-API binaries (no compilation step, unlike
 * the classic `canvas` package which needs system Cairo and routinely
 * fails to build on Vercel).
 *
 * sharp is still used everywhere else in this codebase for actual raster
 * image processing (resize, sharpen, crop, format conversion) — none of
 * that touches the PDF codec, so it's unaffected by this issue.
 */

let pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;
let napiCanvas: typeof import("@napi-rs/canvas") | null = null;

async function loadDeps() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  if (!napiCanvas) {
    napiCanvas = await import("@napi-rs/canvas");
  }
  return { pdfjsLib, napiCanvas };
}

export class PdfRasterUnavailableError extends Error {}

/**
 * Rasterise every page of a PDF buffer into a PNG buffer.
 *
 * @param scale  Render scale — 1.0 ≈ 72dpi (PDF's native unit). Use ~2.2
 *               for crisp on-screen previews, ~3 for AI analysis where
 *               small room labels need to stay legible.
 */
export async function rasterizePdfPages(
  pdfBuffer: Buffer,
  scale = 2.2
): Promise<Buffer[]> {
  let deps;
  try {
    deps = await loadDeps();
  } catch (err) {
    throw new PdfRasterUnavailableError(
      `PDF rendering dependencies not available (pdfjs-dist / @napi-rs/canvas): ${String(err)}`
    );
  }
  const { pdfjsLib: pdfjs, napiCanvas: canvasLib } = deps;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    // No filesystem/worker access needed in a Node serverless function —
    // keep this fully synchronous/in-process.
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  const doc = await loadingTask.promise;
  const images: Buffer[] = [];

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = canvasLib.createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height)
      );
      const ctx = canvas.getContext("2d");

      // White background — architectural PDFs are usually transparent/white
      // already, but this avoids a black canvas fallback on any page that
      // isn't fully opaque.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      images.push(canvas.toBuffer("image/png"));
    }
  } finally {
    await doc.destroy();
  }

  return images;
}

/** Convenience: rasterise just the first page (used where only one is needed). */
export async function rasterizePdfFirstPage(pdfBuffer: Buffer, scale = 2.2): Promise<Buffer> {
  const pages = await rasterizePdfPages(pdfBuffer, scale);
  if (pages.length === 0) throw new Error("PDF has no pages");
  return pages[0];
}
