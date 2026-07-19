/**
 * lib/pdfClient.ts
 *
 * HTTP bridge to the standalone Python renderer service's PDF/image
 * engine (`renderer_service/app/api/v1/endpoints/render_pdf.py`) — the
 * vector-PDF sibling of `lib/cadClient.ts`. Deliberately a separate
 * file/module, not a branch inside cadClient.ts, mirroring that file's
 * own isolation rationale: no caller of `renderCadPlan` needs to change
 * for this to exist, and no caller of `renderPdfPlan` touches the DXF
 * transport at all.
 *
 * V1 scope: vector-drawn PDFs only (exported directly from AutoCAD/
 * Revit/SketchUp, etc.) — a scanned/rasterized PDF is rejected by the
 * service with a `raster_unsupported` error code, surfaced here as-is
 * rather than silently retried or reinterpreted.
 */

const RENDERER_URL = process.env.RENDERER_URL || "http://localhost:8000";
const REQUEST_TIMEOUT_MS = Number(process.env.RENDERER_REQUEST_TIMEOUT_MS) || 30_000;

export interface PdfRoomDetail {
  name: string;
  sizeEstimateSqm: number | null;
  boundingBox: { x: number; y: number; width: number; height: number };
  roomType: string;
  classificationConfidence: number;
}

export interface PdfWarning {
  code: string;
  message: string;
  severity: "info" | "warning";
}

export interface PdfPlanRenderResult {
  svg: string;
  irJson: string; // raw JSON text of the FloorPlanIR, stored as-is
  rooms: PdfRoomDetail[];
  warnings: PdfWarning[];
  theme: string;
  roomCount: number;
  wallCount: number;
}

export interface RenderPdfPlanOptions {
  page?: number; // zero-based page index, for multi-page PDFs (default 0)
  scaleOverride?: string; // drafting scale as "1:N", e.g. "1:100" — see
  // renderer_service/app/services/pdf_scale.py for why this matters.
}

/** Structured error thrown by every function in this file. `code` is
 * either the renderer service's own error code (e.g.
 * "raster_unsupported" for a scanned/flattened PDF with no usable
 * vector geometry) or a transport-level code for failures that never
 * reached the service — mirrors CadServiceError exactly. */
export class PdfServiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PdfServiceError";
    this.code = code;
  }
}

/** True when a PdfServiceError specifically means "this PDF has no
 * usable vector geometry" — callers can use this to show a targeted
 * message ("this looks like a scan — try the image upload path
 * instead") rather than a generic failure. */
export function isRasterUnsupportedError(err: unknown): boolean {
  return err instanceof PdfServiceError && err.code === "raster_unsupported";
}

// ── Core bridge call ───────────────────────────────────────────────────

/**
 * Runs the PDF vector-engine pipeline against a PDF file's contents and
 * returns the render result. Throws `PdfServiceError` on any failure
 * (connection refused, timeout, non-2xx response, malformed response,
 * or a raster-only PDF) — callers catch and turn this into a 4xx/5xx API
 * response. Warnings from the pipeline itself are never thrown; they
 * come back in `.warnings`.
 */
export async function renderPdfPlan(
  pdfBuffer: Buffer,
  originalFilename: string,
  themeKey: string = "modern",
  options: RenderPdfPlanOptions = {}
): Promise<PdfPlanRenderResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }), originalFilename);
  form.append("theme", themeKey);
  if (options.page !== undefined) {
    form.append("page", String(options.page));
  }
  if (options.scaleOverride) {
    form.append("scale_override", options.scaleOverride);
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${RENDERER_URL}/api/v1/render-pdf`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new PdfServiceError(
        "timeout",
        `The renderer service did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${RENDERER_URL}).`
      );
    }
    throw new PdfServiceError(
      "connection_failed",
      `Could not reach the renderer service at ${RENDERER_URL}: ${err?.message ?? err}`
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new PdfServiceError(
      "invalid_response",
      `Renderer service returned a non-JSON response (status ${res.status}).`
    );
  }

  if (!res.ok || body?.ok === false) {
    const code = body?.error?.code ?? `http_${res.status}`;
    const message = body?.error?.message ?? `Renderer service returned ${res.status} with no error detail.`;
    throw new PdfServiceError(code, message);
  }

  if (!body?.svg || !body?.ir || !Array.isArray(body?.rooms)) {
    throw new PdfServiceError(
      "invalid_response",
      "Renderer service returned 200 but the response was missing expected fields (svg/ir/rooms)."
    );
  }

  return {
    svg: body.svg,
    irJson: JSON.stringify(body.ir),
    rooms: body.rooms,
    warnings: body.warnings ?? [],
    theme: body.theme,
    roomCount: body.roomCount,
    wallCount: body.wallCount,
  };
}

// ── Health check (reuses the same renderer_service health endpoint
//    checkRendererHealth() in cadClient.ts already covers — no need to
//    duplicate it here; both engines run in the same process/service) ──
export { checkRendererHealth } from "@/lib/cadClient";
