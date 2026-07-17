# ArchPresent CAD Service — V1 MVP (Local Bridge Implementation)

This package implements the deterministic CAD-to-colored-floor-plan pipeline
described in `archpresent-cad-renderer-v1-architecture.md`, scoped to the
MVP checkpoint (M01–M19: parse → classify → map → render a single theme).

## Important: why this is stdlib-only, and what to swap for production

The target architecture calls for `ezdxf` (DXF parsing), `pydantic` (IR
models), `shapely` (room polygonization), `fastapi` (service API), and
`cairosvg` (rasterization). This implementation was built and tested in an
environment with **no package-installation / network access**, so it uses
only the Python standard library, with the exact same module boundaries and
IR field names the target architecture specifies. Swapping in the real
libraries later is a **drop-in replacement per module**, not a redesign:

| Module here | Stdlib approach used | Production swap |
|---|---|---|
| `dxf_parser.py` | Hand-written ASCII DXF group-code reader (LINE, LWPOLYLINE, INSERT, TEXT/MTEXT, LAYER table) | `ezdxf.readfile()` + `doc.audit()` — adds DWG-via-ODA-converter support, binary DXF support, and far more entity-type robustness |
| `ir_models.py` | `dataclasses` + manual `to_dict`/`validate()` | `pydantic.BaseModel` — same field names, adds schema validation/versioning for free |
| `room_classifier.py` / room polygon logic | Explicit closed-polyline room boundaries only (see "Known V1 MVP limitation" below) | `shapely.ops.polygonize` over the full wall centerline graph, per the original architecture doc §3.1 |
| `svg_renderer.py` | Pure string templating (already matches the target — SVG needs no special library) | Unchanged — this module doesn't need to change |
| `cli.py` | Plain `argparse` + JSON to stdout, invoked by the Next.js app via `child_process` | `api/main.py` — a real FastAPI HTTP service per the architecture doc, with `cli.py` kept as-is for local/batch use |
| Rasterization (SVG → PNG) | **Not done here at all** — delegated to the Next.js side, which already depends on `sharp` (which can rasterize SVG buffers natively) for `lib/planRenderer.ts` and `lib/enhance.ts`. No new dependency introduced. | `cairosvg` if you want PNG/PDF generation to live in the Python service itself instead of the Node bridge |

## Known V1 MVP limitation: room boundaries

The full architecture calls for deriving room polygons from the wall
centerline graph via `shapely.ops.polygonize` (original design doc §3.1).
That requires a real 2D geometry library. Without one, this MVP takes the
simpler, still-legitimate approach used by many real CAD offices: **it reads
explicit closed-polyline room-boundary entities** (on a layer resolved to the
`room_boundary` role by `layer_map.py`, conventionally `A-AREA` / `ROOM` /
`A-ROOM-IDEN`) directly as room polygons, rather than inferring them from
wall geometry. If no explicit room-boundary polylines are found, the parser
falls back to a single "whole plan" room spanning the drawing's overall
extent, and logs a `ParseWarning` — it never invents room subdivisions.

This is flagged in `docs/module-specs` (not yet split into per-module files
in this MVP pass) as the top item to address when `shapely` becomes
available: swap `room_builder.py`'s fallback path for real wall-graph
polygonization, with zero change to anything downstream (the IR shape is
identical either way).

## What this MVP actually does, end to end

```
sample_apartment.dxf
        │
        ▼
dxf_parser.parse_dxf()        — hand-rolled ASCII DXF reader
        │
        ▼
FloorPlanIR (ir_models.py)    — walls, openings, rooms, furniture, labels
        │
        ▼
room_classifier.classify()    — rule-based label-text matching
block_mapper.map_block()      — tokenized block-name → furniture category
        │
        ▼
theme.resolve("modern")       — one theme + one palette, fully specced
        │
        ▼
svg_renderer.render_svg()     — pure-Python SVG string builder
        │
        ▼
pipeline.run()                — orchestrates the above, and produces the
                                 exact RoomDetail[]/RoomBoundingBox shape
                                 the existing Next.js `types/index.ts`
                                 contract expects (normalized 0-1 coords)
        │
        ▼
cli.py                        — JSON to stdout for the Node bridge, SVG
                                 written to the requested output path
```

## Running it

```bash
python3 cad_service/cli.py cad_service/fixtures/sample_apartment.dxf \
    --theme modern --out /tmp/cad_out
```

Prints a JSON summary to stdout (rooms, warnings, output paths) and writes
`plan.svg` (+ `ir.json`) to `--out`.

## Testing

```bash
python3 -m unittest discover cad_service/tests
```

All tests run on the standard library only — no `pip install` required,
matching the constraint that produced this implementation.
