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
