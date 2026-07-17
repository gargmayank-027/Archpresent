"""
cad_service/pipeline.py

Orchestrates the full MVP pipeline and produces two things:
  1. The full FloorPlanIR (for storage/audit/future re-render).
  2. A `rooms` list shaped EXACTLY like the existing Next.js app's
     `RoomDetail[]` / `RoomBoundingBox` contract (types/index.ts) — this is
     the adapter described in the migration plan §3.2/§4: normalized 0-1
     coordinates relative to the rendered plan's overall bounds, so the
     Next.js side's `lib/planCrop.ts`, `lib/pdf.ts`, etc. work completely
     unchanged for CAD-origin projects.
"""

from __future__ import annotations

from dataclasses import dataclass

from cad_service.dxf_parser import parse_dxf, DxfParseError
from cad_service.ingest import build_ir
from cad_service.theme import resolve_theme, Theme
from cad_service.svg_renderer import render_svg
from cad_service.ir_models import FloorPlanIR, RoomType


@dataclass
class PipelineResult:
    ir: FloorPlanIR
    svg: str
    rooms: list[dict]       # Next.js RoomDetail[]-shaped
    theme_key: str
    warnings: list[dict]


def _room_detail_dict(ir: FloorPlanIR) -> list[dict]:
    min_x, min_y, max_x, max_y = ir.bounds()
    # Match the SVG's own margin so normalized boxes line up with what's
    # actually drawn (see svg_renderer.MARGIN_MM).
    from cad_service.svg_renderer import MARGIN_MM
    min_x -= MARGIN_MM
    min_y -= MARGIN_MM
    total_w = (max_x - min_x) + MARGIN_MM
    total_h = (max_y - min_y) + MARGIN_MM
    total_w = total_w or 1.0
    total_h = total_h or 1.0

    rooms = []
    for room in ir.rooms:
        rb_min_x, rb_min_y, rb_max_x, rb_max_y = room.boundary.bounds()
        rooms.append({
            "name": room.label_text or room.room_type.value.replace("_", " ").title(),
            "sizeEstimateSqm": round(room.area_sqm, 1) if room.area_sqm else None,
            "boundingBox": {
                "x": (rb_min_x - min_x) / total_w,
                "y": (rb_min_y - min_y) / total_h,
                "width": (rb_max_x - rb_min_x) / total_w,
                "height": (rb_max_y - rb_min_y) / total_h,
            },
            # Additive, optional fields — not part of the existing
            # RoomBoundingBox shape, ignored by any code that doesn't
            # know about them (see migration plan §2.8).
            "roomType": room.room_type.value,
            "classificationConfidence": room.classification_confidence,
        })
    return rooms


def run_pipeline(dxf_text: str, original_filename: str, theme_key: str = "modern",
                  layer_overrides: dict | None = None,
                  block_overrides: dict | None = None) -> PipelineResult:
    try:
        raw = parse_dxf(dxf_text)
    except DxfParseError as e:
        raise

    ir = build_ir(raw, original_filename, layer_overrides, block_overrides)
    theme: Theme = resolve_theme(theme_key)
    svg = render_svg(ir, theme)
    rooms = _room_detail_dict(ir)

    return PipelineResult(
        ir=ir,
        svg=svg,
        rooms=rooms,
        theme_key=theme.key,
        warnings=[{"code": w.code, "message": w.message, "severity": w.severity} for w in ir.warnings],
    )
