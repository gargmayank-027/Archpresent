"""
tests/test_pdf_geometry.py

Exercises app.services.pdf_geometry and app.services.pdf_router directly
with hand-built RawSegment/PageStats input — no PyMuPDF, no pydantic
needed, since these two modules are deliberately library-free (see their
own module docstrings). Mirrors the manual verification already run
against this exact synthetic plan during development.
"""

from __future__ import annotations

from app.services.pdf_vector_extract import PageGeometry, PageStats, RawSegment, RawText
from app.services.pdf_geometry import reconstruct
from app.services.pdf_router import Route, decide

W, H = 800.0, 600.0
WALL, THIN = 8.0, 1.0


def _synthetic_plan() -> PageGeometry:
    """A 3-room orthogonal plan (Living | Bedroom / Kitchen split), with
    a door gap in the vertical partition, thin dimension lines that must
    be filtered out, and one angled segment that must be ignored+warned."""
    segs = [
        RawSegment(50, 50, 750, 50, WALL), RawSegment(750, 50, 750, 550, WALL),
        RawSegment(750, 550, 50, 550, WALL), RawSegment(50, 550, 50, 50, WALL),
        RawSegment(400, 50, 400, 250, WALL), RawSegment(400, 290, 400, 550, WALL),  # door gap
        RawSegment(400, 300, 750, 300, WALL),
        RawSegment(60, 40, 740, 40, THIN), RawSegment(40, 60, 40, 540, THIN),
        RawSegment(410, 60, 470, 120, WALL),  # angled
    ]
    texts = [
        RawText("LIVING", 200, 295, 260, 310),
        RawText("BEDROOM", 545, 170, 615, 185),
        RawText("KITCHEN", 545, 420, 615, 435),
        RawText("DRG No. A-101", 700, 560, 780, 572),  # title block — excluded
    ]
    return PageGeometry(
        page_width_pt=W, page_height_pt=H, segments=segs, rects=[], texts=texts,
        excluded_regions=[(W * 0.82, 0.0, W, H), (0.0, H * 0.88, W, H)],
    )


def test_thin_annotation_lines_filtered():
    res = reconstruct(_synthetic_plan())
    assert res.walls
    assert all(w.thickness >= 2.0 for w in res.walls)


def test_door_gap_becomes_opening():
    res = reconstruct(_synthetic_plan())
    verticals = [o for o in res.openings if abs(o.x0 - 400) < 3 and abs(o.x1 - 400) < 3]
    assert verticals
    assert any(35 <= o.width <= 45 for o in verticals)


def test_angled_segment_is_ignored_and_warned():
    res = reconstruct(_synthetic_plan())
    assert any("angled" in w for w in res.warnings)


def test_empty_geometry_warns_no_walls():
    geom = PageGeometry(page_width_pt=W, page_height_pt=H, segments=[], rects=[], texts=[])
    res = reconstruct(geom)
    assert not res.walls
    assert any("No wall geometry" in w for w in res.warnings)


def test_router_native_image_is_unsupported():
    assert decide(PageStats(is_native_image=True)) is Route.RASTER_UNSUPPORTED


def test_router_vector_pdf():
    stats = PageStats(drawing_count=200, segment_count=400, raster_image_area_ratio=0.0)
    assert decide(stats) is Route.VECTOR


def test_router_scanned_pdf_is_unsupported():
    stats = PageStats(drawing_count=2, segment_count=1, raster_image_area_ratio=0.95)
    assert decide(stats) is Route.RASTER_UNSUPPORTED


def test_router_bitmap_dominant_no_vector_is_unsupported():
    stats = PageStats(drawing_count=5, segment_count=3, raster_image_area_ratio=0.9)
    assert decide(stats) is Route.RASTER_UNSUPPORTED
