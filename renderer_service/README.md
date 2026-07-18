# ArchPresent Renderer Service

The standalone Python rendering service for ArchPresent's CAD import
pipeline. Talks to the Next.js app over HTTP — never via `child_process`
— per `cad-service-fastapi-migration-plan.md`.

**Sprint 4 status:** `renderer_service` is now the sole rendering engine — the earlier `cad_service/` prototype (Sprints 1-3 ported its logic here, Sprint 3 proved byte-for-byte parity) has been retired and removed from the repo. `app/services/assets.py` was substantially upgraded from placeholder rectangles to detailed, presentation-quality plan-view furniture illustrations (pillows and a folded throw on beds, cushion divisions and rolled arms on seating, cabinet/door panel lines on casework, fixture details on plumbing) — geometry placement (`insertion_point`, `rotation_deg`, `scale`, `footprint_mm`) is byte-exact regardless of this change; see `tests/test_geometry_preservation.py`, the permanent guard for that guarantee. `GET /api/v1/health` and `GET /api/v1/info` are unchanged since Sprint 1. `/parse`, `/export`, and `/themes` are still not implemented.

### Known limitations (carried forward from the retired `cad_service/` prototype)

This is still a stdlib-only parser (no `ezdxf`, `shapely`, or
`cairosvg` — none were installable in the environment this was
developed in). Concretely:

- **Arc/bulge polyline segments are rendered as straight lines** — a
  warning is emitted, not silently dropped.
- **Legacy `POLYLINE`/`VERTEX`/`SEQEND` entities are not supported** —
  only modern `LWPOLYLINE`. A warning is emitted.
- **Room boundaries**: explicit closed polylines on a room-boundary-mapped
  layer (e.g. `A-AREA`) are used when present (most precise). When absent —
  the common case, since most firms don't draw dedicated room-boundary
  polylines — rooms are derived directly from wall geometry via
  `app/services/wall_graph.py` (segment intersection splitting, gap
  closing, half-edge face tracing; pure stdlib, no shapely). This only
  ships a result when it passes a sanity check (`rooms_pass_sanity_check`);
  a wall network with gaps at inconsistent scales — which some real-world
  files genuinely have, at multiple scales simultaneously, with no single
  tolerance able to resolve all of them — is rejected in favor of the
  honest whole-plan fallback, rather than presenting a wrong-but-confident
  room split.
- **Furniture footprints are category-informed defaults**, not
  measured block extents (a real `ezdxf`-based parser would read the
  actual `INSERT`'d block's bounding box).
- **Unit mismatches between a file's $INSUNITS header and its actual drawn units** happen in real production files (confirmed: one real file declared millimeters but was actually authored in inches, detectable only because a room's computed area was off from its own text label by exactly 25.4²). `unit_override` (`mm`/`cm`/`m`/`in`/`ft`) on `POST /api/v1/render` lets the uploader correct this explicitly — see `app/services/units.py`.
- **DWG is not supported** — DXF only. DWG needs the ODA File Converter
  step (architecture doc §1.4), out of scope so far.
- **Only the "Modern" theme is fully implemented** — the other five are
  metadata-only placeholders in `app/services/theme.py`.

None of these are silent — every one of them either raises a clear
validation error or appends a structured warning to the response, per
the "never redesign, never invent, always disclose" principle this
service is built around.

## Project structure

```
renderer_service/
├── app/
│   ├── main.py                    # FastAPI app factory + entrypoint
│   ├── api/v1/
│   │   ├── router.py               # mounts all v1 endpoints under /api/v1
│   │   └── endpoints/
│   │       ├── health.py           # GET  /api/v1/health
│   │       ├── info.py             # GET  /api/v1/info
│   │       └── render.py           # POST /api/v1/render (real pipeline)
│   ├── core/
│   │   ├── logging.py              # dictConfig-based logging setup (text/json)
│   │   └── exceptions.py           # exception hierarchy + global handlers
│   ├── config/
│   │   └── settings.py             # Pydantic Settings (env-driven config)
│   ├── models/                     # domain models — FloorPlanIR (pydantic)
│   ├── schemas/                    # pydantic request/response schemas
│   ├── services/                   # DXF parse -> IR -> theme -> SVG pipeline
│   └── utils/                      # generic helpers (geometry math)
├── tests/
│   ├── conftest.py
│   ├── test_health.py
│   ├── test_info.py
│   └── test_render.py
├── requirements.txt
├── requirements-dev.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── pyproject.toml                  # pytest configuration
└── README.md
```

## Running locally (no Docker)

```bash
cd renderer_service
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

cp .env.example .env               # optional — defaults already work

# Use `python3 -m uvicorn`, not the bare `uvicorn` command — on macOS,
# `--reload` spawns the server via Python's multiprocessing "spawn"
# method, and the bare `uvicorn` command doesn't reliably put the current
# directory on that subprocess's sys.path, causing
# `ModuleNotFoundError: No module named 'app'`. `-m` avoids this.
python3 -m uvicorn app.main:app --reload --port 8000

# If you still see the ModuleNotFoundError, add --app-dir explicitly:
#   python3 -m uvicorn app.main:app --reload --port 8000 --app-dir .
```

Verify it's up:
```bash
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/info
curl -F "file=@/path/to/some.dxf" -F "theme=modern" http://localhost:8000/api/v1/render
```

Interactive API docs (FastAPI auto-generated): http://localhost:8000/docs

## Running with Docker

```bash
cd renderer_service
cp .env.example .env
docker compose up --build
```

Or without Compose:
```bash
cd renderer_service
docker build -t archpresent-renderer .
docker run -p 8000:8000 --env-file .env archpresent-renderer
```

## Running tests

```bash
cd renderer_service
pip install -r requirements-dev.txt
pytest
```

With coverage:
```bash
pytest --cov=app --cov-report=term-missing
```

## Configuration

All settings are read from environment variables (or `.env` in local
dev) via `app/config/settings.py`. See `.env.example` for the full list
and defaults. Nothing else in the codebase reads `os.environ` directly.

| Variable | Default | Notes |
|---|---|---|
| `APP_NAME` | `ArchPresent Renderer Service` | |
| `APP_VERSION` | `0.1.0` | |
| `ENVIRONMENT` | `development` | `development` \| `staging` \| `production` |
| `LOG_LEVEL` | `INFO` | standard Python logging levels |
| `LOG_FORMAT` | `text` | `text` (human-readable) or `json` (structured, for prod log aggregation) |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | |
| `CORS_ALLOW_ORIGINS` | `http://localhost:3000` | comma-separated list |
| `MAX_UPLOAD_SIZE_MB` | `20` | enforced by `/render`'s validation layer |
| `REQUEST_TIMEOUT_SECONDS` | `30` | not yet enforced server-side in Sprint 1 (no long-running work exists yet); documented for the client side (`lib/cadClient.ts`) to use |

## API (Sprint 1)

| Method | Path | Status |
|---|---|---|
| `GET` | `/api/v1/health` | Implemented |
| `GET` | `/api/v1/info` | Implemented |
| `POST` | `/api/v1/render` | Implemented — real DXF parsing, classification, and SVG rendering |

Every error response uses one consistent envelope:
```json
{ "ok": false, "error": { "code": "invalid_request", "message": "..." } }
```

## Related documents

- `../cad-service-fastapi-migration-plan.md` — the approved architecture this service implements
