"""
tests/test_render_pipeline.py

Exercises app.services.render_pipeline directly (no HTTP layer) — the
same assertions that were manually verified against the real fixture
during development (see Sprint 2 implementation notes), now codified as
a real, repeatable test.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET

import pytest

from app.services import render_pipeline
from app.services.dxf_parser import DxfParseError
from app.models.floorplan import RoomType, FurnitureCategory


@pytest.fixture()
def result(sample_apartment_dxf_bytes: bytes):
    return render_pipeline.run(sample_apartment_dxf_bytes.decode("utf-8"), "sample_apartment.dxf", theme_key="modern")


def test_two_rooms_found(result) -> None:
    assert len(result.ir.rooms) == 2


def test_room_areas_correct(result) -> None:
    areas = sorted(r.area_sqm for r in result.ir.rooms)
    assert areas[0] == pytest.approx(20.0, abs=0.1)
    assert areas[1] == pytest.approx(20.0, abs=0.1)


def test_room_types_classified(result) -> None:
    types = {r.room_type for r in result.ir.rooms}
    assert types == {RoomType.LIVING, RoomType.BEDROOM}


def test_furniture_extracted_and_openings_excluded(result) -> None:
    # 3 furniture INSERTs (SOFA, DINING_TABLE, QUEEN_BED) — door/window
    # INSERTs must NOT be counted as furniture.
    assert len(result.ir.furniture) == 3
    categories = {f.category for f in result.ir.furniture}
    assert categories == {FurnitureCategory.SOFA, FurnitureCategory.DINING_TABLE, FurnitureCategory.QUEEN_BED}


def test_openings_extracted(result) -> None:
    assert len(result.ir.openings) == 2


def test_walls_extracted(result) -> None:
    assert len(result.ir.walls) == 2  # perimeter + partition


def test_svg_is_well_formed_xml(result) -> None:
    root = ET.fromstring(result.svg)  # raises if malformed
    assert root.tag.endswith("svg")


def test_room_summaries_are_normalized_0_to_1(result) -> None:
    for room in result.rooms:
        for key in ("x", "y", "width", "height"):
            assert 0.0 <= room.bounding_box[key] <= 1.0


def test_ir_is_json_serializable(result) -> None:
    json.dumps(result.ir.model_dump(mode="json"))


def test_unknown_theme_falls_back_to_modern(sample_apartment_dxf_bytes: bytes) -> None:
    result = render_pipeline.run(sample_apartment_dxf_bytes.decode("utf-8"), "sample_apartment.dxf",
                                  theme_key="totally_made_up")
    assert result.theme_key == "modern"


def test_empty_dxf_falls_back_to_whole_plan_room_without_inventing_subdivisions() -> None:
    dxf = (
        "0\nSECTION\n2\nENTITIES\n"
        "0\nLINE\n5\n1\n8\nA-WALL\n10\n0\n20\n0\n11\n1000\n21\n0\n"
        "0\nENDSEC\n0\nEOF\n"
    )
    result = render_pipeline.run(dxf, "no_rooms.dxf")
    assert len(result.ir.rooms) == 1
    assert any(w["code"] == "no_room_boundaries_found" for w in result.warnings)


def test_completely_empty_content_raises_dxf_parse_error() -> None:
    with pytest.raises(DxfParseError):
        render_pipeline.run("", "empty.dxf")


# ── Wall-graph room detection (no explicit boundary polylines) ─────────
# See app/services/wall_graph.py and tests/test_wall_graph.py for the
# algorithm's own unit tests. These exercise it through the full
# pipeline, using a fixture with the SAME layout as sample_apartment.dxf
# but with the A-AREA boundary polylines removed — proving the fallback
# actually engages and produces the right rooms when a file has no
# explicit room boundaries, which is the common real-world case.

@pytest.fixture()
def walls_only_dxf_bytes() -> bytes:
    import os
    path = os.path.join(os.path.dirname(__file__), "fixtures", "sample_apartment_walls_only.dxf")
    with open(path, "rb") as f:
        return f.read()


def test_wall_graph_derives_correct_rooms_when_no_boundaries_present(walls_only_dxf_bytes: bytes) -> None:
    result = render_pipeline.run(walls_only_dxf_bytes.decode("utf-8"), "sample_apartment_walls_only.dxf")
    assert len(result.ir.rooms) == 2
    areas = sorted(round(r.area_sqm, 1) for r in result.ir.rooms)
    assert areas == [20.0, 20.0]
    assert any(w["code"] == "rooms_derived_from_wall_graph" for w in result.warnings)


def test_wall_graph_fallback_produces_valid_svg(walls_only_dxf_bytes: bytes) -> None:
    import xml.etree.ElementTree as ET
    result = render_pipeline.run(walls_only_dxf_bytes.decode("utf-8"), "sample_apartment_walls_only.dxf")
    root = ET.fromstring(result.svg)
    assert root.tag.endswith("svg")


def test_insufficient_wall_geometry_falls_back_to_whole_plan_not_wall_graph_rejection() -> None:
    """A single open line isn't a 'fragmented wall network' — it's simply
    not enough geometry to attempt room detection at all. These should
    get different, distinguishable warning codes (see ingest.py's
    wall_graph_warning_added flag)."""
    dxf = (
        "0\nSECTION\n2\nENTITIES\n"
        "0\nLINE\n5\n1\n8\nA-WALL\n10\n0\n20\n0\n11\n1000\n21\n0\n"
        "0\nENDSEC\n0\nEOF\n"
    )
    result = render_pipeline.run(dxf, "insufficient.dxf")
    assert len(result.ir.rooms) == 1
    assert any(w["code"] == "no_room_boundaries_found" for w in result.warnings)
    assert not any(w["code"] == "wall_graph_detection_rejected" for w in result.warnings)


# ── Unit override (see app/services/units.py) ───────────────────────────
# Motivated by a real file where $INSUNITS declared millimeters but the
# drawing was actually authored in inches — confirmed by a computed room
# area being off from its own text label by exactly 25.4^2.

def test_unit_override_changes_computed_areas(sample_apartment_dxf_bytes: bytes) -> None:
    """sample_apartment.dxf's rooms are 20 sqm each when treated as mm
    (the correct interpretation for that fixture). Forcing unit_override
    to inches should scale every linear dimension by 25.4x, and every
    area by 25.4^2 -- proving the override actually takes effect, not
    just that it's accepted without error."""
    normal = render_pipeline.run(sample_apartment_dxf_bytes.decode("utf-8"), "sample_apartment.dxf")
    overridden = render_pipeline.run(
        sample_apartment_dxf_bytes.decode("utf-8"), "sample_apartment.dxf", unit_override="in"
    )
    normal_area = normal.ir.rooms[0].area_sqm
    overridden_area = overridden.ir.rooms[0].area_sqm
    assert overridden_area == pytest.approx(normal_area * (25.4 ** 2), rel=0.001)
    assert any(w["code"] == "unit_override_applied" for w in overridden.warnings)


def test_invalid_unit_override_does_not_crash_the_pipeline(sample_apartment_dxf_bytes: bytes) -> None:
    result = render_pipeline.run(
        sample_apartment_dxf_bytes.decode("utf-8"), "sample_apartment.dxf", unit_override="furlongs"
    )
    assert len(result.ir.rooms) == 2  # unaffected -- falls back to normal $INSUNITS handling
    assert any(w["code"] == "invalid_unit_override" for w in result.warnings)
