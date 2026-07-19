"""
tests/test_ingest_pdf.py

Exercises app.services.ingest_pdf.build_ir_from_geometry directly with a
hand-built PageGeometry — no PyMuPDF needed (build_ir_from_geometry is
the pure, library-free half of ingest_pdf.py; only
build_ir_from_pdf_bytes needs PyMuPDF, and that's covered separately in
test_render_pdf.py). Needs pydantic (app.models.floorplan), same as
every other IR-touching test in this suite.
"""

from __future__ import annotations

from app.models.floorplan import RoomType, OpeningKind
from app.services.pdf_vector_extract import PageGeometry, RawSegment, RawText
from app.services.ingest_pdf import build_ir_from_geometry

W, H = 800.0, 600.0
WALL, THIN = 8.0, 1.0


def _synthetic_plan() -> PageGeometry:
    segs = [
        RawSegment(50, 50, 750, 50, WALL), RawSegment(750, 50, 750, 550, WALL),
        RawSegment(750, 550, 50, 550, WALL), RawSegment(50, 550, 50, 50, WALL),
        RawSegment(400, 50, 400, 250, WALL), RawSegment(400, 253.5, 400, 550, WALL),
        RawSegment(400, 300, 750, 300, WALL),
    ]
    texts = [
        RawText("LIVING", 200, 295, 260, 310),
        RawText("BEDROOM", 545, 170, 615, 185),
        RawText("KITCHEN", 545, 420, 615, 435),
    ]
    return PageGeometry(page_width_pt=W, page_height_pt=H, segments=segs, rects=[], texts=texts)


def test_rooms_classified_from_labels():
    ir = build_ir_from_geometry(_synthetic_plan(), "synthetic.pdf", scale_override="1:1")
    types = {r.label_text: r.room_type for r in ir.rooms}
    assert types.get("LIVING") == RoomType.LIVING
    assert types.get("BEDROOM") == RoomType.BEDROOM
    assert types.get("KITCHEN") == RoomType.KITCHEN


def test_walls_have_pdf_vector_provenance():
    ir = build_ir_from_geometry(_synthetic_plan(), "synthetic.pdf", scale_override="1:1")
    assert ir.walls
    assert all(w.layer == "pdf-vector" for w in ir.walls)
    assert ir.provenance.source_format == "pdf_vector"


def test_openings_default_to_door_with_warning():
    ir = build_ir_from_geometry(_synthetic_plan(), "synthetic.pdf", scale_override="1:1")
    assert ir.openings
    assert all(o.kind == OpeningKind.DOOR for o in ir.openings)
    assert any(w.code == "opening_kind_unresolved" for w in ir.warnings)


def test_furniture_always_empty_in_vector_v1():
    ir = build_ir_from_geometry(_synthetic_plan(), "synthetic.pdf", scale_override="1:1")
    assert ir.furniture == []


def test_no_scale_override_warns_and_assumes_1_to_1():
    ir = build_ir_from_geometry(_synthetic_plan(), "synthetic.pdf")  # no scale_override
    assert any(w.code == "unknown_pdf_scale" for w in ir.warnings)


def test_scale_override_applied_and_affects_area():
    ir_1to1 = build_ir_from_geometry(_synthetic_plan(), "synthetic.pdf", scale_override="1:1")
    ir_1to100 = build_ir_from_geometry(_synthetic_plan(), "synthetic.pdf", scale_override="1:100")
    assert any(w.code == "scale_override_applied" for w in ir_1to100.warnings)
    # 1:100 means each mm is 100x larger in reality -> area scales by 100^2
    assert ir_1to100.rooms[0].area_sqm > ir_1to1.rooms[0].area_sqm * 9000


def test_empty_plan_falls_back_to_whole_plan_room():
    geom = PageGeometry(page_width_pt=W, page_height_pt=H, segments=[], rects=[], texts=[])
    ir = build_ir_from_geometry(geom, "empty.pdf", scale_override="1:1")
    assert len(ir.rooms) == 1
    assert ir.rooms[0].room_type == RoomType.UNCLASSIFIED
    assert any(w.code == "no_room_boundaries_found" for w in ir.warnings)


def test_plan_id_and_schema_version_present():
    ir = build_ir_from_geometry(_synthetic_plan(), "synthetic.pdf", scale_override="1:1")
    assert ir.plan_id
    assert ir.schema_version
