"""
cad_service/layer_map.py

Config-driven layer-name -> semantic-role resolution, per the original
architecture doc's `layer_map.py` module spec. Ships with sensible AIA-style
defaults; a per-project override dict can be passed in to handle offices
with idiosyncratic naming, without any code change.
"""

from __future__ import annotations

# Roles the rest of the pipeline understands.
ROLE_WALL = "wall"
ROLE_DOOR = "door"
ROLE_WINDOW = "window"
ROLE_FURNITURE = "furniture"
ROLE_ROOM_LABEL = "room_label"
ROLE_ROOM_BOUNDARY = "room_boundary"
ROLE_DIMENSION = "dimension"
ROLE_SITE = "site"
ROLE_UNKNOWN = "unknown"

# Default token -> role table. A layer matches a role if any of its tokens
# (split on "-", "_", whitespace, uppercased) appears in the role's token set.
DEFAULT_LAYER_TOKENS: dict[str, set[str]] = {
    ROLE_WALL:           {"WALL", "WALLS"},
    ROLE_DOOR:           {"DOOR", "DOORS"},
    ROLE_WINDOW:         {"WINDOW", "WINDOWS", "WIN"},
    ROLE_FURNITURE:      {"FURN", "FURNITURE", "FURNISHING", "EQPM"},
    ROLE_ROOM_LABEL:     {"IDEN", "LABEL", "TEXT", "ROOMNAME", "TAG"},
    ROLE_ROOM_BOUNDARY:  {"AREA", "ROOM", "BOUNDARY", "ZONE"},
    ROLE_DIMENSION:      {"DIM", "DIMS", "DIMENSION"},
    ROLE_SITE:           {"SITE", "PLOT", "LANDSCAPE", "TREE", "DRIVEWAY", "PATIO"},
}


def _tokenize(name: str) -> set[str]:
    import re
    return set(t for t in re.split(r"[-_\s]+", name.upper()) if t)


def resolve_layer_role(layer_name: str, overrides: dict[str, str] | None = None) -> str:
    """
    Resolve a DXF layer name to a semantic role.
    `overrides` maps an exact layer name -> role, and takes precedence
    (the per-project config-over-code escape hatch described in the
    architecture doc).
    """
    if overrides and layer_name in overrides:
        return overrides[layer_name]

    tokens = _tokenize(layer_name)
    for role, role_tokens in DEFAULT_LAYER_TOKENS.items():
        if tokens & role_tokens:
            return role
    return ROLE_UNKNOWN
