"""
cad_service/block_mapper.py

The Block Mapping System from the architecture doc §5: resolves varied
CAD block names (BED, BED01, DOUBLEBED, KING_BED, ...) to one semantic
FurnitureCategory, deterministically, via tokenization + pattern rules.
No geometry-based guessing (see the architecture doc's explicit non-goal).

Resolution order:
  1. exact_overrides (per-project, exact block-name match)         -> stage 1
  2. token pattern rules (ordered, first full-token-subset match)  -> stage 2
  3. GENERIC fallback                                              -> stage 3
"""

from __future__ import annotations

import re

from cad_service.ir_models import FurnitureCategory, OpeningKind


_SPLIT_RE = re.compile(r"[-_\s]+|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])")


def tokenize(block_name: str) -> set[str]:
    """Splits on separators AND letter/digit boundaries, so 'BED01' tokenizes
    to {'BED','01'} just like 'BED_01' or 'BED-01' would — a trailing
    numeric suffix should never prevent a semantic match."""
    return set(t for t in _SPLIT_RE.split(block_name.upper()) if t)


# Ordered: more specific token sets first, so "BED"+"KING" resolves to
# KING_BED before the bare "BED" fallback rule can claim it.
PATTERN_RULES: list[tuple[set[str], FurnitureCategory]] = [
    ({"BED", "KING"}, FurnitureCategory.KING_BED),
    ({"BED", "QUEEN"}, FurnitureCategory.QUEEN_BED),
    ({"DOUBLEBED"}, FurnitureCategory.QUEEN_BED),
    ({"BED"}, FurnitureCategory.BED),
    ({"SOFA"}, FurnitureCategory.SOFA),
    ({"SETTEE"}, FurnitureCategory.SOFA),
    ({"ARMCHAIR"}, FurnitureCategory.ARMCHAIR),
    ({"DINING", "TABLE"}, FurnitureCategory.DINING_TABLE),
    ({"DINING", "CHAIR"}, FurnitureCategory.DINING_CHAIR),
    ({"COFFEE", "TABLE"}, FurnitureCategory.COFFEE_TABLE),
    ({"TV"}, FurnitureCategory.TV_UNIT),
    ({"WARDROBE"}, FurnitureCategory.WARDROBE),
    ({"CLOSET"}, FurnitureCategory.WARDROBE),
    ({"DESK"}, FurnitureCategory.DESK),
    ({"COUNTER"}, FurnitureCategory.KITCHEN_COUNTER),
    ({"KITCHEN"}, FurnitureCategory.KITCHEN_COUNTER),
    ({"SINK"}, FurnitureCategory.SINK),
    ({"WC"}, FurnitureCategory.WC),
    ({"TOILET"}, FurnitureCategory.WC),
    ({"BATHTUB"}, FurnitureCategory.BATHTUB),
    ({"TUB"}, FurnitureCategory.BATHTUB),
]

# Which block-name tokens indicate an opening (door/window) rather than
# furniture. Used by the extractor to route INSERT entities correctly
# when layer role alone is ambiguous.
DOOR_TOKENS = {"DOOR"}
WINDOW_TOKENS = {"WINDOW", "WIN"}


def classify_opening_kind(block_name: str) -> OpeningKind | None:
    tokens = tokenize(block_name)
    if tokens & DOOR_TOKENS:
        return OpeningKind.DOOR
    if tokens & WINDOW_TOKENS:
        return OpeningKind.WINDOW
    return None


def map_block(
    block_name: str,
    exact_overrides: dict[str, FurnitureCategory] | None = None,
) -> tuple[FurnitureCategory, int]:
    """
    Returns (category, stage) where stage is 1 (exact override), 2
    (pattern match) or 3 (generic fallback) — surfaced to the IR so
    low-confidence mappings are visible, never silent (architecture doc §5.2).
    """
    if exact_overrides and block_name in exact_overrides:
        return exact_overrides[block_name], 1

    tokens = tokenize(block_name)
    for pattern_tokens, category in PATTERN_RULES:
        if pattern_tokens.issubset(tokens):
            return category, 2

    return FurnitureCategory.GENERIC, 3
