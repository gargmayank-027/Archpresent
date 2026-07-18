"""tests/test_block_mapper.py"""

from __future__ import annotations

from app.services.block_mapper import map_block, classify_opening_kind
from app.models.floorplan import FurnitureCategory, OpeningKind


def test_exact_bed_variants_resolve_consistently() -> None:
    for name in ["BED", "BED01", "BED_A"]:
        cat, stage = map_block(name)
        assert cat == FurnitureCategory.BED
        assert stage == 2


def test_king_bed_disambiguation() -> None:
    cat, _ = map_block("KING_BED")
    assert cat == FurnitureCategory.KING_BED


def test_queen_bed_disambiguation() -> None:
    cat, _ = map_block("DOUBLEBED")
    assert cat == FurnitureCategory.QUEEN_BED


def test_unknown_block_falls_back_to_generic() -> None:
    cat, stage = map_block("XYZ_UNKNOWN_THING_123")
    assert cat == FurnitureCategory.GENERIC
    assert stage == 3


def test_exact_override_takes_precedence() -> None:
    cat, stage = map_block("CUSTOM01", exact_overrides={"CUSTOM01": FurnitureCategory.SOFA})
    assert cat == FurnitureCategory.SOFA
    assert stage == 1


def test_classify_opening_kind_door() -> None:
    assert classify_opening_kind("DOOR") == OpeningKind.DOOR
    assert classify_opening_kind("DOOR_SINGLE") == OpeningKind.DOOR


def test_classify_opening_kind_window() -> None:
    assert classify_opening_kind("WINDOW") == OpeningKind.WINDOW
    assert classify_opening_kind("WIN_BAY") == OpeningKind.WINDOW


def test_classify_opening_kind_none_for_furniture() -> None:
    assert classify_opening_kind("SOFA") is None
