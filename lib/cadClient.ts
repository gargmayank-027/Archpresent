/**
 * lib/cadClient.ts
 *
 * HTTP bridge to the standalone Python renderer service
 * (`renderer_service/`, a FastAPI app — see
 * cad-service-fastapi-migration-plan.md). This is the swap the file's
 * own previous version always said was coming: the Sprint 1-4
 * `child_process`/`spawn`/`python3` local-subprocess bridge is gone
 * entirely, replaced by `fetch()` against `RENDERER_URL`.
 *
 * No caller needed to change for this swap — `app/api/cad/upload/route.ts`,
 * `app/api/cad/render/route.ts`, and `app/api/cad/themes/route.ts` only
 * ever touched this file's exports (`renderCadPlan`, `CAD_THEMES`,
 * `CadRenderResult`), never the transport underneath them. That isolation
 * is what makes this a one-file change.
 */

const RENDERER_URL = process.env.RENDERER_URL || "http://localhost:8000";
const REQUEST_TIMEOUT_MS = Number(process.env.RENDERER_REQUEST_TIMEOUT_MS) || 30_000;

export interface CadRoomDetail {
  name: string;
  sizeEstimateSqm: number | null;
  boundingBox: { x: number; y: number; width: number; height: number };
  roomType: string;
  classificationConfidence: number;
}

export interface CadWarning {
  code: string;
  message: string;
  severity: "info" | "warning";
}

export interface CadRenderResult {
  svg: string;
  irJson: string;           // raw JSON text of the FloorPlanIR, stored as-is
  rooms: CadRoomDetail[];
  warnings: CadWarning[];
  theme: string;
  roomCount: number;
  furnitureCount: number;
  wallCount: number;
  unmappedBlockNames: string[]; // furniture block names that fell back to the generic
                                 // symbol — feed back via blockOverrides to fix them.
}

export interface CadThemeMeta {
  key: string;
  name: string;
  description: string;
  available: boolean;
}

export interface RenderCadPlanOptions {
  unitOverride?: string;                  // "mm" | "cm" | "m" | "in" | "ft"
  blockOverrides?: Record<string, string>; // raw block name -> furniture category
}

/** Structured error thrown by every function in this file — always has a
 * `code` matching the renderer service's error envelope (or a
 * transport-level code for failures that never reached the service), so
 * callers can distinguish "bad file" from "service unreachable" if they
 * want to (today's callers just catch-and-surface the message, but the
 * code is there for when that needs to get more specific). */
export class CadServiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CadServiceError";
    this.code = code;
  }
}

// ── Core bridge call ───────────────────────────────────────────────────

/**
 * Runs the CAD pipeline against a DXF file's contents and returns the
 * render result. Throws `CadServiceError` on any failure (connection
 * refused, timeout, non-2xx response, malformed response) — callers
 * catch and turn this into a 4xx/5xx API response. Warnings from the
 * pipeline itself are never thrown; they come back in `.warnings`.
 */
export async function renderCadPlan(
  dxfBuffer: Buffer,
  originalFilename: string,
  themeKey: string = "modern",
  options: RenderCadPlanOptions = {}
): Promise<CadRenderResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(dxfBuffer)], { type: "application/octet-stream" }), originalFilename);
  form.append("theme", themeKey);
  if (options.unitOverride) {
    form.append("unit_override", options.unitOverride);
  }
  if (options.blockOverrides && Object.keys(options.blockOverrides).length > 0) {
    form.append("block_overrides", JSON.stringify(options.blockOverrides));
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${RENDERER_URL}/api/v1/render`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new CadServiceError(
        "timeout",
        `The renderer service did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${RENDERER_URL}).`
      );
    }
    throw new CadServiceError(
      "connection_failed",
      `Could not reach the renderer service at ${RENDERER_URL}: ${err?.message ?? err}`
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  let body: any;
  try {
    body = await res.json();
  } catch (err) {
    throw new CadServiceError(
      "invalid_response",
      `Renderer service returned a non-JSON response (status ${res.status}).`
    );
  }

  if (!res.ok || body?.ok === false) {
    const code = body?.error?.code ?? `http_${res.status}`;
    const message = body?.error?.message ?? `Renderer service returned ${res.status} with no error detail.`;
    throw new CadServiceError(code, message);
  }

  if (!body?.svg || !body?.ir || !Array.isArray(body?.rooms)) {
    throw new CadServiceError(
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
    furnitureCount: body.furnitureCount,
    wallCount: body.wallCount,
    unmappedBlockNames: body.unmappedBlockNames ?? [],
  };
}

// ── Health check (not used by any caller yet — available for a future
//    startup/diagnostic check without needing another file) ────────────

export async function checkRendererHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${RENDERER_URL}/api/v1/health`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { ok: false, detail: `Renderer health check returned ${res.status}` };
    const body = await res.json();
    return { ok: body?.status === "ok", detail: JSON.stringify(body) };
  } catch (err: any) {
    return { ok: false, detail: `Renderer unreachable at ${RENDERER_URL}: ${err?.message ?? err}` };
  }
}

// ── Theme listing ──────────────────────────────────────────────────────
// renderer_service does not yet expose GET /api/v1/themes (Sprint 4
// scope explicitly excluded it) — this stays a static list, mirroring
// renderer_service/app/services/theme.py's list_themes() output exactly.
// Swapping this for a real `fetch(`${RENDERER_URL}/api/v1/themes`)` call
// is a same-shape, same-file change whenever that endpoint ships — no
// caller of CAD_THEMES needs to change either way.

export const CAD_THEMES: CadThemeMeta[] = [
  { key: "modern", name: "Modern", description: "Clean lines, light neutral walls, confident muted room tints.", available: true },
  { key: "luxury", name: "Luxury", description: "Rich tones, generous whitespace.", available: false },
  { key: "scandinavian", name: "Scandinavian", description: "Pale woods, airy minimalism.", available: false },
  { key: "minimal", name: "Minimal", description: "Fewest colors, most whitespace.", available: false },
  { key: "traditional", name: "Traditional", description: "Warm, classic, timeless.", available: false },
  { key: "industrial", name: "Industrial", description: "Bold, high-contrast, raw.", available: false },
];
