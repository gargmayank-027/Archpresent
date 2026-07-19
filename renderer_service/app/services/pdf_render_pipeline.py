"""
app/services/pdf_render_pipeline.py

Orchestrates the PDF-vector pipeline: extract vector geometry -> build
IR -> resolve theme -> render SVG -> adapt rooms. Deliberately mirrors
`render_pipeline.py`'s `run()` shape (same `PipelineResult` fields), and
reuses `theme.py` / `svg_renderer.py` / `room_summary.py` completely
unchanged — those three only ever touch `FloorPlanIR`, never anything
DXF- or PDF-specific, so the same themed-SVG output the DXF path
produces comes out here too, for free.

`app/services/render_pipeline.py` (the DXF pipeline) is not imported by
or imported from this module — the two are siblings, not layered on
each other, so nothing here can affect the DXF path.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.services.ingest_pdf import build_ir_from_pdf_bytes
from app.services.pdf_vector_extract import PdfOpenError
from app.services.theme import resolve_theme, Theme
from app.services.svg_renderer import render_svg
from app.services.room_summary import RoomSummary, room_summaries
from app.models.floorplan import FloorPlanIR

logger = logging.getLogger(__name__)


class PdfParseError(Exception):
    """Hard failure — the file could not be read as a PDF at all, or the
    requested page doesn't exist. Named distinctly from DxfParseError
    (dxf_parser.py) so callers can tell which engine actually failed."""


@dataclass
class PipelineResult:
    ir: FloorPlanIR
    svg: str
    rooms: list[RoomSummary]
    theme_key: str
    warnings: list[dict]


def run(
    pdf_bytes: bytes,
    original_filename: str,
    theme_key: str = "modern",
    page_index: int = 0,
    scale_override: str | None = None,
) -> PipelineResult:
    """
    Runs the full PDF-vector pipeline end to end. Raises `PdfParseError`
    on hard failure (corrupt file, page out of range) — callers (the
    /render-pdf endpoint) are expected to catch it and translate it into
    the API's structured error response, same pattern as `DxfParseError`
    on the DXF side.

    `scale_override`: a drafting-scale ratio "1:N" (e.g. "1:100"). See
    `app/services/pdf_scale.py`'s module docstring for why this exists
    and what happens if it's omitted (an honest 1:1 fallback + warning,
    not a silent guess).
    """
    try:
        ir = build_ir_from_pdf_bytes(pdf_bytes, original_filename, page_index, scale_override)
    except PdfOpenError as exc:
        raise PdfParseError(str(exc)) from exc

    theme: Theme = resolve_theme(theme_key)
    svg = render_svg(ir, theme)
    rooms = room_summaries(ir)

    logger.info(
        "PDF render pipeline complete: filename=%s theme=%s rooms=%d walls=%d warnings=%d",
        original_filename, theme.key, len(ir.rooms), len(ir.walls), len(ir.warnings),
    )

    return PipelineResult(
        ir=ir,
        svg=svg,
        rooms=rooms,
        theme_key=theme.key,
        warnings=[{"code": w.code, "message": w.message, "severity": w.severity} for w in ir.warnings],
    )
