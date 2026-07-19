"""
app/services/pdf_router.py

Decides whether a page is worth running the vector-geometry path on, or
should be rejected as raster/scanned in this V1 (which handles vector
PDFs only — see ingest_pdf.py's module docstring for the V2 raster/CV
scope this deliberately excludes). Pure function of `PageStats`, so it's
unit-testable without PyMuPDF (see tests/test_pdf_geometry.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.services.pdf_vector_extract import PageStats


class Route(str, Enum):
    VECTOR = "vector"
    RASTER_UNSUPPORTED = "raster_unsupported"


@dataclass
class RouterConfig:
    # Below this many vector draw commands, there's nothing meaningful to
    # extract — treat as raster/scanned.
    min_drawings_for_vector: int = 40
    # If a bitmap covers more than this fraction of the page, the "real"
    # plan is probably that embedded image (a scan pasted into a PDF),
    # even if some vector chrome (a border, a title block) exists.
    raster_dominant_area_ratio: float = 0.55


def decide(stats: PageStats, cfg: RouterConfig | None = None) -> Route:
    cfg = cfg or RouterConfig()

    if stats.is_native_image:
        return Route.RASTER_UNSUPPORTED

    has_vector = (stats.drawing_count >= cfg.min_drawings_for_vector
                  and stats.segment_count > 0)
    bitmap_dominant = stats.raster_image_area_ratio >= cfg.raster_dominant_area_ratio

    if bitmap_dominant and not has_vector:
        return Route.RASTER_UNSUPPORTED
    if has_vector:
        return Route.VECTOR
    return Route.RASTER_UNSUPPORTED
