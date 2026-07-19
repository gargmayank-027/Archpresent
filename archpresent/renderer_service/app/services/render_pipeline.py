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

`RoomSummary` and the IR->RoomSummary adapter now live in
`room_summary.py` (extracted so `pdf_render_pipeline.py` can reuse them
without duplicating the normalization math — the same "one shared
module instead of duplicated private functions" pattern already used
for `app/utils/geometry.py`). Both names are re-exported here
unchanged, so no existing import site (`from app.services.render_pipeline
import RoomSummary`, `result.rooms`, etc.) needs to change.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.services.dxf_parser import parse_dxf, DxfParseError
from app.services.ingest import build_ir
from app.services.theme import resolve_theme, Theme
from app.services.svg_renderer import render_svg, MARGIN_MM
from app.services.room_summary import RoomSummary, room_summaries as _room_summaries
from app.models.floorplan import FloorPlanIR

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    ir: FloorPlanIR
    svg: str
    rooms: list[RoomSummary]
    theme_key: str
    warnings: list[dict]


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
