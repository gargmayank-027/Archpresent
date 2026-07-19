# PDF/Image Floor Plan Engine — Patch for ArchPresent

This is a **diff-only patch**: 19 new/changed files, applied on top of your
existing `archpresent/` project folder. It adds a second, vector-PDF input
engine alongside the existing DXF engine — **the DXF path is completely
untouched** (see "What was NOT touched" below).

## What this adds

- **Backend** (`renderer_service/`): a new `POST /api/v1/render-pdf`
  endpoint that parses **vector-drawn PDFs** (exported from AutoCAD/Revit/
  SketchUp — not scans) into the exact same `FloorPlanIR` the DXF engine
  produces, reusing `wall_graph.py` and `room_classifier.py` verbatim.
- **Frontend bridge**: `lib/pdfClient.ts` + two new API routes
  (`/api/pdf-plan/upload`, `/api/pdf-plan/render`), mirroring the existing
  `lib/cadClient.ts` / `/api/cad/*` routes file-for-file.
- **UI**: an opt-in "Try vector-quality PDF engine (Beta)" checkbox on the
  new-project page, shown only when a `.pdf` is selected, **default OFF** —
  today's PDF behavior (rasterize client-side → AI analysis) is completely
  unchanged unless a user explicitly checks it.

## What was NOT touched

- `dxf_parser.py`, `ingest.py`, `layer_map.py`, `block_mapper.py`,
  `wall_graph.py`, `theme.py`, `svg_renderer.py`, `units.py` — zero edits.
- `/api/cad/upload`, `/api/cad/render`, `lib/cadClient.ts` — zero edits.
- The default PDF/PNG/JPEG upload path — zero behavior change unless the
  new checkbox is explicitly checked.
- `render_pipeline.py` (DXF pipeline) has **one internal refactor**: its
  `RoomSummary`/`_room_summaries` were extracted into a new shared
  `room_summary.py` (so the PDF pipeline can reuse them) and re-exported
  under the same names — no import site anywhere else needs to change,
  and this was verified against the existing test file's import list
  before making the change.

## 1. Unzip into your project folder

From a terminal, `cd` into the **parent** of your existing `archpresent`
folder (i.e. wherever you'd see `archpresent/` if you ran `ls`), then:

```bash
cd ~/Downloads   # or wherever you saved the zip
unzip -o archpresent-pdf-engine-patch.zip -d /path/to/your/project/folder
```

`-o` overwrites the one existing file this patch touches
(`renderer_service/app/api/v1/router.py`, `render_pipeline.py`,
`requirements.txt`, `app/project/new/page.tsx`, `types/index.ts`) — those
are the 5 files listed under "changed" below; everything else is new.

If your project folder is literally named `archpresent` and sits in
`~/projects/`, that command looks like:

```bash
unzip -o ~/Downloads/archpresent-pdf-engine-patch.zip -d ~/projects/
```

(the zip's internal paths already start with `archpresent/...`, so `-d`
should point at the folder that *contains* your `archpresent/` directory).

## 2. Install the one new backend dependency

```bash
cd archpresent/renderer_service
source .venv/bin/activate   # or however you normally activate it
pip install -r requirements.txt   # now includes pymupdf
```

## 3. Test the backend directly (fastest way to verify it works)

```bash
cd archpresent/renderer_service
pytest tests/test_pdf_geometry.py tests/test_ingest_pdf.py tests/test_render_pdf.py -v
```

- `test_pdf_geometry.py` and `test_ingest_pdf.py` need no new dependency
  beyond what's already installed (pydantic).
- `test_render_pdf.py` needs `pymupdf` (installed above) — it builds a
  synthetic 3-room vector PDF at test time using PyMuPDF itself, so
  there's no fixture file to check in.
- Also re-run the full existing suite to confirm the DXF path is untouched:
  ```bash
  pytest -v
  ```

Then start the service and hit the new endpoint directly with curl (handy
for eyeballing the actual IR/SVG output):

```bash
uvicorn app.main:app --reload   # from renderer_service/

# in another terminal — grab any vector-drawn PDF floor plan you have
curl -X POST http://localhost:8000/api/v1/render-pdf \
  -F "file=@/path/to/your/plan.pdf" \
  -F "theme=modern" \
  -F "scale_override=1:100" | python3 -m json.tool | less
```

A scanned/rasterized PDF should come back with HTTP 422 and
`"code": "raster_unsupported"` — that's the correct, intentional response
for this V1 (see `pdf_router.py`'s docstring).

## 4. Test through the Next.js app

```bash
cd archpresent
npm run dev
```

Make sure `RENDERER_URL` in your `.env.local` points at the running
renderer service (default `http://localhost:8000`, already in
`.env.local.example`).

Go to **New Project**, upload a **vector-drawn PDF** floor plan, check
**"Try vector-quality PDF engine (Beta)"**, optionally enter the drafting
scale (e.g. `1:100`), and submit. You should land on the review page with
rooms already detected — same flow as the DXF path.

Or skip the UI and curl the new route directly:

```bash
curl -X POST http://localhost:3000/api/pdf-plan/upload \
  -F "name=Test Project" -F "clientName=Test Client" -F "firmName=Test Studio" \
  -F "plan=@/path/to/your/plan.pdf" -F "scaleOverride=1:100"
```

## 5. Push to git

```bash
cd archpresent
git add -A
git status   # sanity-check the file list before committing
git commit -m "Add vector-PDF floor plan engine alongside the DXF engine

- New POST /api/v1/render-pdf in renderer_service, reusing wall_graph.py
  and room_classifier.py to emit the same FloorPlanIR the DXF engine does
- New lib/pdfClient.ts + /api/pdf-plan/{upload,render} routes, mirroring
  the existing CAD bridge file-for-file
- Opt-in UI checkbox on the new-project page (default off; existing PDF
  upload behavior is unchanged unless explicitly selected)
- DXF path untouched; RoomSummary extracted into a shared room_summary.py
  so both pipelines reuse it without duplication"
git push
```

## Known V1 limitations (all surfaced as explicit warnings in the response, never silently guessed)

- **Vector PDFs only.** Scanned/flattened plans are rejected with
  `raster_unsupported`, not mis-parsed — a raster/CV engine is a separate,
  future piece of work.
- **No furniture detection** from vector geometry alone — `furniture: []`
  always, with no attempt to guess.
- **Doors and windows aren't distinguished** — every detected opening
  gap is reported as `door`, with a warning explaining why.
- **Scale defaults to 1:1 if you don't supply `scale_override`/
  `scaleOverride`** (a PDF has no scale header at all, unlike DXF's
  `$INSUNITS`) — always check for the `unknown_pdf_scale` warning code if
  you didn't set it, since room sizes will be wrong without it.
- **Orthogonal walls only** — angled/curved vector paths are ignored with
  a warning, not approximated.
