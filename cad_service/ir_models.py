"""
cad_service/ir_models.py

The frozen Intermediate Representation (IR). Field names and nesting
deliberately mirror the pydantic schema in the original architecture
document 1:1, so migrating this module to `pydantic.BaseModel` later is a
mechanical find-and-replace, not a redesign.

Stdlib-only (dataclasses), because pydantic is not installable in this
environment. See cad_service/README.md for the production swap notes.

Units: all coordinates are in millimetres, origin as-drawn in the source
DXF (no re-centering), Y-up, angles in degrees counter-clockwise from +X —
matching DXF convention, same as the original design.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


SCHEMA_VERSION = "1.0.0"


# ── Geometry primitives ──────────────────────────────────────────────────

@dataclass
class Point2D:
    x: float
    y: float


@dataclass
class Polyline:
    points: list[Point2D] = field(default_factory=list)
    closed: bool = False

    def bounds(self) -> tuple[float, float, float, float]:
        """Returns (min_x, min_y, max_x, max_y). Empty polyline -> zeros."""
        if not self.points:
            return (0.0, 0.0, 0.0, 0.0)
        xs = [p.x for p in self.points]
        ys = [p.y for p in self.points]
        return (min(xs), min(ys), max(xs), max(ys))


# ── Enums ─────────────────────────────────────────────────────────────────

class OpeningKind(str, Enum):
    DOOR = "door"
    WINDOW = "window"
    OPEN_ARCH = "open_archway"


class RoomType(str, Enum):
    BEDROOM = "bedroom"
    LIVING = "living"
    KITCHEN = "kitchen"
    DINING = "dining"
    BATHROOM = "bathroom"
    DRESSING = "dressing"
    POOJA = "pooja"
    OUTDOOR = "outdoor"
    LOBBY = "lobby"
    STUDY = "study"
    UTILITY = "utility"
    UNCLASSIFIED = "unclassified"


class FurnitureCategory(str, Enum):
    BED = "bed"
    QUEEN_BED = "queen_bed"
    KING_BED = "king_bed"
    SOFA = "sofa"
    ARMCHAIR = "armchair"
    DINING_TABLE = "dining_table"
    DINING_CHAIR = "dining_chair"
    COFFEE_TABLE = "coffee_table"
    TV_UNIT = "tv_unit"
    WARDROBE = "wardrobe"
    DESK = "desk"
    KITCHEN_COUNTER = "kitchen_counter"
    SINK = "sink"
    WC = "wc"
    BATHTUB = "bathtub"
    GENERIC = "generic"


class LabelRole(str, Enum):
    ROOM_NAME = "room_name"
    DIMENSION_NOTE = "dimension_note"
    GENERAL_ANNOTATION = "general_annotation"


# ── Entities ──────────────────────────────────────────────────────────────

@dataclass
class Wall:
    id: str
    centerline: Polyline
    thickness_mm: float
    layer: str
    source_entity_handle: str
    height_mm: Optional[float] = None


@dataclass
class Opening:
    id: str
    kind: OpeningKind
    wall_id: Optional[str]
    position: Point2D
    width_mm: float
    rotation_deg: float
    block_name: str
    source_entity_handle: str
    swing_arc: Optional[Polyline] = None


@dataclass
class Room:
    id: str
    boundary: Polyline
    area_sqm: float
    room_type: RoomType = RoomType.UNCLASSIFIED
    label_text: Optional[str] = None
    classification_confidence: float = 0.0


@dataclass
class FurnitureItem:
    id: str
    block_name: str
    category: FurnitureCategory
    insertion_point: Point2D
    rotation_deg: float
    scale_x: float
    scale_y: float
    source_entity_handle: str
    footprint_mm: tuple[float, float] = (600.0, 600.0)  # (width, depth), from block extents
    room_id: Optional[str] = None
    mapping_stage: int = 3  # 1=exact override, 2=pattern match, 3=generic fallback


@dataclass
class TextLabel:
    id: str
    text: str
    position: Point2D
    height_mm: float
    rotation_deg: float
    role: LabelRole = LabelRole.GENERAL_ANNOTATION


@dataclass
class ParseWarning:
    code: str
    message: str
    severity: str = "warning"  # "info" | "warning"
    related_entity_handle: Optional[str] = None


@dataclass
class Provenance:
    original_filename: str
    source_format: str
    parsed_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    parser_version: str = "mvp-stdlib-0.1.0"
    insunits_raw: int = 4  # DXF default: 4 = millimeters


@dataclass
class FloorPlanIR:
    plan_id: str
    provenance: Provenance
    walls: list[Wall] = field(default_factory=list)
    openings: list[Opening] = field(default_factory=list)
    rooms: list[Room] = field(default_factory=list)
    furniture: list[FurnitureItem] = field(default_factory=list)
    labels: list[TextLabel] = field(default_factory=list)
    warnings: list[ParseWarning] = field(default_factory=list)
    schema_version: str = SCHEMA_VERSION

    def bounds(self) -> tuple[float, float, float, float]:
        """Overall drawing extent across walls + rooms. (min_x, min_y, max_x, max_y)."""
        xs_min, ys_min, xs_max, ys_max = [], [], [], []
        for w in self.walls:
            b = w.centerline.bounds()
            xs_min.append(b[0]); ys_min.append(b[1]); xs_max.append(b[2]); ys_max.append(b[3])
        for r in self.rooms:
            b = r.boundary.bounds()
            xs_min.append(b[0]); ys_min.append(b[1]); xs_max.append(b[2]); ys_max.append(b[3])
        if not xs_min:
            return (0.0, 0.0, 1000.0, 1000.0)
        return (min(xs_min), min(ys_min), max(xs_max), max(ys_max))

    def to_dict(self) -> dict:
        return asdict(self)


def new_id(prefix: str, counter: int) -> str:
    return f"{prefix}-{counter:04d}"
