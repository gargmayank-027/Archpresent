"""
app/api/v1/endpoints/render_pdf.py

POST /api/v1/render-pdf — the PDF/image engine's sibling to POST
/api/v1/render. Deliberately a separate route, not a branch inside
`render.py`, so the existing DXF endpoint's request/response contract
and tests are completely undisturbed by this addition (same "new,
isolated route — zero risk to the existing path" pattern the Next.js
side already uses for `/api/cad/upload` vs. `/api/projects`).

V1 scope: vector-geometry PDFs only (see pdf_router.py). A PDF with no
usable vector geometry (a scanned plan, a flattened image-only PDF)
returns a 422 with a clear `raster_unsupported` error code — this
endpoint does not silently fall back to guessing, and does not attempt
any raster/CV path (that's out of scope for this slice; see the
PDF/Image engine design doc's V2 scope).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Form, UploadFile, File

from app.config.settings import Settings, get_settings
from app.core.exceptions import PayloadTooLargeException, RenderException, ValidationException
from app.schemas.render import RenderResponse
from app.services import pdf_render_pipeline
from app.services.pdf_render_pipeline import PdfParseError
from app.services.pdf_router import Route, decide
from app.services.pdf_vector_extract import page_stats, PdfOpenError

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_EXTENSIONS = (".pdf",)


class RasterUnsupportedException(ValidationException):
    """The PDF has no usable vector geometry (scanned / flattened /
    image-only). Distinct code from the generic ValidationException so
    `lib/pdfClient.ts` can show a specific, actionable message instead
    of a generic 'invalid request'."""

    code = "raster_unsupported"
    status_code = 422


def _validate_upload(file: UploadFile, size_bytes: int, settings: Settings) -> None:
    filename = file.filename or ""
    if not filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise ValidationException(
            f"Unsupported file type. Expected one of {ALLOWED_EXTENSIONS}, got '{filename}'."
        )
    if size_bytes == 0:
        raise ValidationException("Uploaded file is empty.")
    if size_bytes > settings.max_upload_size_bytes:
        raise PayloadTooLargeException(
            f"File is {size_bytes / (1024 * 1024):.1f} MB, which exceeds the "
            f"{settings.max_upload_size_mb} MB limit."
        )


@router.post(
    "/render-pdf",
    response_model=RenderResponse,
    summary="Render a floor plan from a vector PDF",
    description=(
        "Accepts a PDF file, checks it has usable vector geometry (walls drawn as real vector "
        "paths, not a scanned image), and returns a themed SVG floor plan plus structured room/"
        "warning data — the same FloorPlanIR shape and response contract as POST /render. "
        "Scanned/raster-only PDFs are rejected with a clear error rather than guessed at; "
        "raster support is a planned separate engine, not this endpoint."
    ),
)
async def render_pdf(
    file: UploadFile = File(..., description="The PDF plan to render (.pdf)"),
    theme: str = Form(default="modern", description="Theme key to render with"),
    page: int = Form(default=0, description="Zero-based page index, for multi-page PDFs"),
    scale_override: str | None = Form(
        default=None,
        description=(
            "Optional: the plan's drafting/plot scale as '1:N' (e.g. '1:100'). PDFs carry no "
            "scale header at all (unlike DXF's $INSUNITS) — without this, room sizes are computed "
            "assuming a 1:1 plot, which is almost always wrong for a real architectural drawing. "
            "See app/services/pdf_scale.py."
        ),
    ),
    settings: Settings = Depends(get_settings),
) -> RenderResponse:
    contents = await file.read()
    size_bytes = len(contents)

    _validate_upload(file, size_bytes, settings)

    filename = file.filename or "unknown.pdf"
    logger.info(
        "PDF render request accepted: filename=%s size_bytes=%d theme=%s page=%d scale_override=%s",
        filename, size_bytes, theme, page, scale_override,
    )

    try:
        stats = page_stats(contents, page)
    except PdfOpenError as exc:
        raise ValidationException(str(exc)) from exc

    route = decide(stats)
    if route is Route.RASTER_UNSUPPORTED:
        raise RasterUnsupportedException(
            "This PDF does not have enough usable vector geometry to parse (it looks like a "
            "scanned image or a flattened/rasterized plan). This engine currently supports "
            "vector-drawn PDFs (exported directly from AutoCAD/Revit/SketchUp, etc.) only."
        )

    try:
        result = pdf_render_pipeline.run(
            contents, filename, theme_key=theme, page_index=page, scale_override=scale_override,
        )
    except PdfParseError as exc:
        logger.info("PDF parse failed for %s: %s", filename, exc)
        raise ValidationException(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — anything else is a render-stage failure
        logger.exception("Unexpected PDF render pipeline failure for %s", filename)
        raise RenderException(f"Rendering failed: {exc}") from exc

    return RenderResponse(
        svg=result.svg,
        ir=result.ir.model_dump(mode="json"),
        rooms=[
            {
                "name": r.name,
                "sizeEstimateSqm": r.size_estimate_sqm,
                "boundingBox": r.bounding_box,
                "roomType": r.room_type,
                "classificationConfidence": r.classification_confidence,
            }
            for r in result.rooms
        ],
        warnings=result.warnings,
        theme=result.theme_key,
        roomCount=len(result.ir.rooms),
        furnitureCount=len(result.ir.furniture),
        wallCount=len(result.ir.walls),
        unmappedBlockNames=[],  # no furniture detection in this V1 vector-only path
    )
