/**
 * lib/cadClient.ts
 *
 * Bridge to the Python CAD renderer (`cad_service/`). V1 MVP invokes it as
 * a local subprocess via `child_process` rather than over HTTP — this is a
 * deliberate interim choice (see cad_service/README.md and
 * archpresent-cad-migration-plan.md Phase 3), not a permanent one:
 *
 *   Today:  Next.js API route --(child_process)--> cad_service/cli.py
 *   Later:  Next.js API route --(fetch, HTTP)-----> FastAPI service
 *
 * Every function in this file is written so that swap only touches this
 * one file — no caller (the `app/api/cad/*` routes) needs to change when
 * the subprocess bridge is replaced with a real HTTP client, because the
 * return shape (`CadRenderResult`) stays the same either way.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

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
}

export interface CadThemeMeta {
  key: string;
  name: string;
  description: string;
  available: boolean;
}

// ── Config ──────────────────────────────────────────────────────────────

function cadServiceRoot(): string {
  // Repo root — this file lives at <repo>/lib/cadClient.ts, cad_service/
  // lives at <repo>/cad_service/.
  return path.resolve(process.cwd());
}

function python3Bin(): string {
  return process.env.CAD_SERVICE_PYTHON_BIN || "python3";
}

// ── Core bridge call ───────────────────────────────────────────────────

/**
 * Runs the CAD pipeline against a DXF file's contents and returns the
 * render result. Throws a plain Error with a user-safe message on any
 * failure (bad file, parser crash, missing interpreter) — callers should
 * catch and turn this into a 4xx API response, matching the error-model
 * requirement in the architecture doc §7 (distinguish hard failures from
 * warnings; warnings are returned in `.warnings`, never thrown).
 */
export async function renderCadPlan(
  dxfBuffer: Buffer,
  originalFilename: string,
  themeKey: string = "modern"
): Promise<CadRenderResult> {
  const workDir = await mkdtemp(path.join(tmpdir(), "archpresent-cad-"));
  const dxfPath = path.join(workDir, "input.dxf");
  const outDir = path.join(workDir, "out");

  try {
    await writeFile(dxfPath, dxfBuffer);

    const cliPath = path.join(cadServiceRoot(), "cad_service", "cli.py");
    let stdout: string;
    try {
      const result = await execFileAsync(
        python3Bin(),
        [cliPath, dxfPath, "--theme", themeKey, "--out", outDir],
        { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 }
      );
      stdout = result.stdout;
    } catch (err: any) {
      // execFile throws on non-zero exit — the CLI still prints JSON to
      // stdout in that case (see cad_service/cli.py's error-JSON contract).
      stdout = err?.stdout ?? "";
      if (!stdout) {
        throw new Error(
          `CAD service did not run (is python3 available? is cad_service/ present?): ${err?.message ?? err}`
        );
      }
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stdout.trim().split("\n").pop()!); // last line, in case anything else prints
    } catch {
      throw new Error(`CAD service returned unparseable output: ${stdout.slice(0, 500)}`);
    }

    if (!parsed.ok) {
      throw new Error(parsed.error || "CAD service failed for an unknown reason");
    }

    const [svg, irJson] = await Promise.all([
      readFile(parsed.svgPath, "utf-8"),
      readFile(parsed.irPath, "utf-8"),
    ]);

    return {
      svg,
      irJson,
      rooms: parsed.rooms,
      warnings: parsed.warnings,
      theme: parsed.theme,
      roomCount: parsed.roomCount,
      furnitureCount: parsed.furnitureCount,
      wallCount: parsed.wallCount,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Theme listing ──────────────────────────────────────────────────────
// Mirrors cad_service/theme.py's list_themes(). Kept as a small static
// list here (rather than shelling out) since it's pure metadata and the
// picker UI needs it to render instantly — if the theme list ever needs
// to be dynamic, swap this for a `python3 -c "..."` call without touching
// any caller, same as the render bridge above.

export const CAD_THEMES: CadThemeMeta[] = [
  { key: "modern", name: "Modern", description: "Clean lines, light neutral walls, confident muted room tints.", available: true },
  { key: "luxury", name: "Luxury", description: "Rich tones, generous whitespace.", available: false },
  { key: "scandinavian", name: "Scandinavian", description: "Pale woods, airy minimalism.", available: false },
  { key: "minimal", name: "Minimal", description: "Fewest colors, most whitespace.", available: false },
  { key: "traditional", name: "Traditional", description: "Warm, classic, timeless.", available: false },
  { key: "industrial", name: "Industrial", description: "Bold, high-contrast, raw.", available: false },
];
