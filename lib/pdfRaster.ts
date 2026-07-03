/**
 * lib/pdfRaster.ts
 *
 * Server-side PDF page splitting using pdf-lib (pure JS, zero native deps).
 *
 * PREVIOUS APPROACH (failed): sharp → libvips has no PDF codec on Vercel.
 * SECOND ATTEMPT (failed): pdfjs-dist + @napi-rs/canvas → native .node
 * binary can't be bundled by webpack, and @napi-rs/canvas isn't available
 * at runtime in Vercel's serverless environment.
 *
 * CURRENT APPROACH: Don't rasterise on the server at all.
 *  - pdf-lib (pure JS, already a dependency) splits multi-page PDFs into
 *    single-page PDF buffers. No rendering, no native deps.
 *  - Client-side (browser), pdfjs-dist renders each page to a native
 *    <canvas> element for the floor picker preview.
 *  - When the architect picks a floor, the client renders it at high
 *    resolution, converts to PNG via canvas.toBlob(), and uploads the PNG
 *    back to the server — giving us a clean raster image for AI analysis,
 *    cropping, and everything downstream that expects a PNG/JPEG.
 */

import { PDFDocument } from "pdf-lib";

export class PdfRasterUnavailableError extends Error {}

/**
 * Split a multi-page PDF into individual single-page PDF buffers.
 * Returns one Buffer per page, each a valid standalone PDF.
 */
export async function splitPdfPages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const pageCount = srcDoc.getPageCount();

  if (pageCount === 0) {
    throw new Error("PDF has no pages");
  }

  const pages: Buffer[] = [];

  for (let i = 0; i < pageCount; i++) {
    const newDoc = await PDFDocument.create();
    const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
    newDoc.addPage(copiedPage);
    const bytes = await newDoc.save();
    pages.push(Buffer.from(bytes));
  }

  return pages;
}

/** Get the number of pages in a PDF without splitting it. */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer);
  return doc.getPageCount();
}

// ── Legacy exports kept for backward compat with lib/enhance.ts and
//    lib/planCrop.ts defensive paths. These should never actually run in
//    the normal flow now (PDFs are split into single-page PDFs at upload
//    time, then rasterised to PNG client-side before analysis), but if
//    they do, they throw a clear error rather than silently failing.

export async function rasterizePdfPages(
  _pdfBuffer: Buffer,
  _scale?: number
): Promise<Buffer[]> {
  throw new PdfRasterUnavailableError(
    "Server-side PDF rasterisation is not available in this environment. " +
    "PDFs should be rasterised client-side (browser canvas) before upload."
  );
}

export async function rasterizePdfFirstPage(
  _pdfBuffer: Buffer,
  _scale?: number
): Promise<Buffer> {
  throw new PdfRasterUnavailableError(
    "Server-side PDF rasterisation is not available in this environment. " +
    "PDFs should be rasterised client-side (browser canvas) before upload."
  );
}
