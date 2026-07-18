"""
app/services/render_pipeline.py

Orchestrates the full pipeline: parse -> build IR -> resolve theme ->
render SVG -> adapt rooms to a client-friendly shape. This is what
app/api/v1/endpoints/render.py calls. Ported from cad_service/pipeline.py
(there named `pipeline.py`; renamed here to `render_pipeline.py` since
`app/services/` will eventually hold more than one pipeline — e.g. a
future V2 enhancement pipeline — and an unqualified `pipeline.py` would
stop being an obvious name at that point. Everything it does is
unchanged.).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.services.dxf_parser import parse_dxf, DxfParseError
from app.services.ingest import build_ir
from app.services.theme import resolve_theme, Theme
from app.services.svg_renderer import render_svg, MARGIN_MM
from app.models.floorplan import FloorPlanIR

logger = logging.getLogger(__name__)


@dataclass
class RoomSummary:
    """A room, adapted to the shape the API response (and, eventually,
    the ArchPresent Next.js app's RoomDetail contract) expects: normalized
    0-1 bounding box coordinates relative to the rendered plan's overall
    bounds, rather than raw millimetre coordinates."""
    name: str
    size_estimate_sqm: float | None
    bounding_box: dict[str, float]
    room_type: str
    classification_confidence: float


@dataclass
class PipelineResult:
    ir: FloorPlanIR
    svg: str
    rooms: list[RoomSummary]
    theme_key: str
    warnings: list[dict]


def _room_summaries(ir: FloorPlanIR) -> list[RoomSummary]:
    min_x, min_y, max_x, max_y = ir.bounds()
    # Match the SVG's own margin so normalized boxes line up with what's
    # actually drawn (see svg_renderer.MARGIN_MM).
    min_x -= MARGIN_MM
    min_y -= MARGIN_MM
    total_w = ((max_x - min_x) + MARGIN_MM) or 1.0
    total_h = ((max_y - min_y) + MARGIN_MM) or 1.0

    summaries: list[RoomSummary] = []
    for room in ir.rooms:
        rb_min_x, rb_min_y, rb_max_x, rb_max_y = room.boundary.bounds()
        summaries.append(RoomSummary(
            name=room.label_text or room.room_type.value.replace("_", " ").title(),
            size_estimate_sqm=round(room.area_sqm, 1) if room.area_sqm else None,
            bounding_box={
                "x": (rb_min_x - min_x) / total_w,
                "y": (rb_min_y - min_y) / total_h,
                "width": (rb_max_x - rb_min_x) / total_w,
                "height": (rb_max_y - rb_min_y) / total_h,
            },
            room_type=room.room_type.value,
            classification_confidence=room.classification_confidence,
        ))
    return summaries


def run(dxf_text: str, original_filename: str, theme_key: str = "modern",
        layer_overrides: dict | None = None,
        block_overrides: dict | None = None,
        unit_override: str | None = None) -> PipelineResult:
    """
    Runs the full pipeline end to end. Raises `DxfParseError` (from
    app.services.dxf_parser) on hard parse failure — callers (the
    /render endpoint) are expected to catch it and translate it into the
    API's structured error response.

    `unit_override`: one of "mm"/"cm"/"m"/"in"/"ft" — overrides the
    file's own $INSUNITS header entirely. Use when a file's declared
    units don't match what it was actually drawn in (see
    app/services/units.py's docstring for a real example of this).
    """
    raw = parse_dxf(dxf_text)  # raises DxfParseError on hard failure
    ir = build_ir(raw, original_filename, layer_overrides, block_overrides, unit_override)
    theme: Theme = resolve_theme(theme_key)
    svg = render_svg(ir, theme)
    rooms = _room_summaries(ir)

    logger.info(
        "Render pipeline complete: filename=%s theme=%s rooms=%d furniture=%d walls=%d warnings=%d",
        original_filename, theme.key, len(ir.rooms), len(ir.furniture), len(ir.walls), len(ir.warnings),
    )

    return PipelineResult(
        ir=ir,
        svg=svg,
        rooms=rooms,
        theme_key=theme.key,
        warnings=[{"code": w.code, "message": w.message, "severity": w.severity} for w in ir.warnings],
    )
