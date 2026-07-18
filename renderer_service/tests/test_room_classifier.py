"""tests/test_room_classifier.py"""

from __future__ import annotations

from app.services.room_classifier import classify_room
from app.models.floorplan import RoomType


def test_living_room_synonyms() -> None:
    for label in ["Living Room", "DRAWING ROOM", "Sitting Area"]:
        rt, conf = classify_room(label)
        assert rt == RoomType.LIVING
        assert conf > 0


def test_bedroom_compound_label() -> None:
    rt, _ = classify_room("BEDROOM1")
    assert rt == RoomType.BEDROOM


def test_unrecognized_label_is_unclassified() -> None:
    rt, conf = classify_room("Zzyx Chamber")
    assert rt == RoomType.UNCLASSIFIED
    assert conf == 0.0


def test_none_label_is_unclassified() -> None:
    rt, conf = classify_room(None)
    assert rt == RoomType.UNCLASSIFIED


def test_empty_string_label_is_unclassified() -> None:
    rt, conf = classify_room("")
    assert rt == RoomType.UNCLASSIFIED


def test_wiw_abbreviation_classifies_as_dressing() -> None:
    """Real-world label: "W.I.W-2 8'-1 1/2"X11'-9"" — a walk-in-wardrobe
    abbreviation that doesn't tokenize as a single word (the dots split
    it into "W","I","W"), so it only matches via the substring fallback,
    not the primary token-set check. Confidence is 0.7 (substring match),
    not 1.0."""
    rt, conf = classify_room("W.I.W-2 8'-1 1/2\"X11'-9\"")
    assert rt == RoomType.DRESSING
    assert conf == 0.7


def test_walk_in_classifies_as_dressing() -> None:
    rt, conf = classify_room("WALK-IN CLOSET")
    assert rt == RoomType.DRESSING
