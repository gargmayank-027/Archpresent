/**
 * scripts/copy-pdf-worker.mjs
 *
 * Copies the pdf.js worker out of node_modules into public/ so the browser can
 * load it same-origin from /pdf.worker.min.mjs.
 *
 * Why not just point workerSrc at a CDN?
 *   - It's an external runtime dependency for core features (plan upload, plan
 *     review, export preview). If cdnjs is blocked or slow, they all break.
 *     This app already got bitten by DNS blocking on Vercel with HuggingFace.
 *   - pdf.js wraps cross-origin workers in a generated blob shim
 *     (PDFWorker._createCDNWrapper), which is an extra fetch + hop. Same-origin
 *     skips that path entirely.
 *   - The CDN version can drift from the installed pdfjs-dist. Copying from
 *     node_modules means the worker always matches the library exactly.
 *
 * Why not commit the worker to public/?
 *   It's a ~1.3MB build artefact that must stay in lockstep with the
 *   pdfjs-dist version in package.json. Generating it removes that drift.
 *
 * Wired into the `prebuild` and `predev` npm hooks, so it runs automatically
 * before `next build` (including on Vercel) and before `next dev`.
 */

import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// Derive paths from this file's own location rather than process.cwd(). npm
// happens to run scripts with cwd set to the package root, but relying on that
// would silently write public/ into the wrong place if the script is ever
// invoked directly from another directory.
const HERE = dirname(fileURLToPath(import.meta.url));
const DEST_DIR = join(HERE, "..", "public");
const DEST = join(DEST_DIR, "pdf.worker.min.mjs");

try {
  // Resolve via the package entry rather than hardcoding node_modules/, so this
  // still works with hoisting, workspaces, or a different install layout.
  const pdfjsEntry = require.resolve("pdfjs-dist");
  const src = join(dirname(pdfjsEntry), "pdf.worker.min.mjs");

  if (!existsSync(src)) {
    throw new Error(`worker not found at ${src}`);
  }

  mkdirSync(DEST_DIR, { recursive: true });
  copyFileSync(src, DEST);

  const { version } = require("pdfjs-dist/package.json");
  console.log(`[copy-pdf-worker] pdfjs-dist@${version} → public/pdf.worker.min.mjs`);
} catch (err) {
  // Fail the build loudly. A missing worker doesn't surface until a user opens
  // the export or review screen, so silently continuing would ship a broken
  // deploy that looks green.
  console.error("[copy-pdf-worker] FAILED:", err.message);
  console.error("[copy-pdf-worker] pdf.js features (plan upload, review, export preview) would break at runtime.");
  process.exit(1);
}
