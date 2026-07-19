"""
app/services/room_summary.py

`RoomSummary` + the IR -> RoomSummary adapter, extracted out of
`render_pipeline.py` so the new PDF/image pipeline (`pdf_render_pipeline.py`)
can reuse it without duplicating the normalization math. Pure function of
`FloorPlanIR` — knows nothing about DXF or PDF specifically, exactly like
`room_classifier.py` and `theme.py` already didn't. `render_pipeline.py`
re-exports `RoomSummary` and imports this module's function as
`_room_summaries` for backward compatibility, so no existing import site
changes.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.floorplan import FloorPlanIR
from app.services.svg_renderer import MARGIN_MM


@dataclass
class RoomSummary:
    """A room, adapted to the shape the API response (and the ArchPresent
    Next.js app's RoomDetail contract) expects: normalized 0-1 bounding
    box coordinates relative to the rendered plan's overall bounds, rather
    than raw millimetre coordinates."""
    name: str
    size_estimate_sqm: float | None
    bounding_box: dict[str, float]
    room_type: str
    classification_confidence: float


def room_summaries(ir: FloorPlanIR) -> list[RoomSummary]:
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
