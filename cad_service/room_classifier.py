"""
cad_service/room_classifier.py

Rule-based (no ML, no LLM) room-label classification, per the architecture
doc §5/M14. Falls back to UNCLASSIFIED rather than guessing — this mirrors
the "never invent" principle used throughout the V1 architecture, and
reuses the exact same room-type vocabulary already live in the existing
Next.js app (`lib/planRenderer.ts` / `components/FloodFillRenderer.tsx`),
so downstream palette/theme lookups can key off identical room_type values
regardless of whether a project is image- or CAD-origin.
"""

from __future__ import annotations

from cad_service.ir_models import RoomType

# Kept in sync with ROOM_COLORS / classifyRoom in the existing Next.js
# codebase (lib/planRenderer.ts, components/FloodFillRenderer.tsx) so a
# CAD-origin room and an image-origin room classify identically for the
# same label text.
SYNONYMS: dict[RoomType, set[str]] = {
    RoomType.BEDROOM:   {"BED", "BEDROOM", "MASTER", "MBR", "BR"},
    RoomType.LIVING:    {"LIVING", "DRAWING", "SITTING", "LOUNGE"},
    RoomType.KITCHEN:   {"KITCHEN", "KIT", "PANTRY", "SERVICE"},
    RoomType.DINING:    {"DINING", "DINNING"},
    RoomType.BATHROOM:  {"TOILET", "BATH", "WC", "POWDER", "WASHROOM"},
    RoomType.DRESSING:  {"DRESS", "WARDROBE", "WIC", "CLOSET"},
    RoomType.POOJA:     {"POOJA", "PUJA", "PRAYER", "MANDIR"},
    RoomType.OUTDOOR:   {"BALCONY", "TERRACE", "PORCH", "GARDEN", "LAWN", "DECK"},
    RoomType.LOBBY:     {"LOBBY", "FOYER", "ENTRY", "STAIR", "PASSAGE", "LIFT", "CORRIDOR"},
    RoomType.STUDY:     {"STUDY", "OFFICE", "LIBRARY"},
    RoomType.UTILITY:   {"UTILITY", "LAUNDRY", "STORE", "MAID", "SERVANT"},
}


def _tokenize(text: str) -> set[str]:
    import re
    return set(t for t in re.split(r"[^A-Za-z0-9]+", text.upper()) if t)


def classify_room(label_text: str | None) -> tuple[RoomType, float]:
    """Returns (room_type, confidence). confidence is a simple match-strength
    heuristic: 1.0 for a token-level match, 0.0 for no match at all."""
    if not label_text:
        return RoomType.UNCLASSIFIED, 0.0

    tokens = _tokenize(label_text)
    for room_type, synonyms in SYNONYMS.items():
        if tokens & synonyms:
            return room_type, 1.0

    # Substring fallback for compound labels a pure token split might miss
    # (e.g. "BEDROOM1" with no separator).
    upper = label_text.upper()
    for room_type, synonyms in SYNONYMS.items():
        for syn in synonyms:
            if syn in upper:
                return room_type, 0.7

    return RoomType.UNCLASSIFIED, 0.0
