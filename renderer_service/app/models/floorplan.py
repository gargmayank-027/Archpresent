"""
app/models/floorplan.py

The frozen Intermediate Representation (IR) — the contract between the
parsing layer and the rendering layer. Field names and nesting are
ported 1:1 from the Sprint 1-era `cad_service/ir_models.py` (which used
plain dataclasses, since pydantic wasn't a working dependency at the
time it was written). This is the pydantic version that module's own
README always said would replace it once pydantic was actually
available — see cad_service/README.md's swap table.

Units: all coordinates are in millimetres, origin as-drawn in the source
DXF (no re-centering), Y-up, angles in degrees counter-clockwise from +X
— matching DXF convention.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0.0"


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


# ── Geometry primitives ──────────────────────────────────────────────────

class Point2D(BaseModel):
    x: float
    y: float


class Polyline(BaseModel):
    points: list[Point2D] = Field(default_factory=list)
    closed: bool = False

    def bounds(self) -> tuple[float, float, float, float]:
        """Returns (min_x, min_y, max_x, max_y). Empty polyline -> zeros."""
        if not self.points:
            return (0.0, 0.0, 0.0, 0.0)
        xs = [p.x for p in self.points]
        ys = [p.y for p in self.points]
        return (min(xs), min(ys), max(xs), max(ys))


# ── Entities ──────────────────────────────────────────────────────────────

class Wall(BaseModel):
    id: str
    centerline: Polyline
    thickness_mm: float
    layer: str
    source_entity_handle: str
    height_mm: Optional[float] = None


class Opening(BaseModel):
    id: str
    kind: OpeningKind
    wall_id: Optional[str] = None
    position: Point2D
    width_mm: float
    rotation_deg: float
    block_name: str
    source_entity_handle: str
    swing_arc: Optional[Polyline] = None


class Room(BaseModel):
    id: str
    boundary: Polyline
    area_sqm: float
    room_type: RoomType = RoomType.UNCLASSIFIED
    label_text: Optional[str] = None
    classification_confidence: float = 0.0


class FurnitureItem(BaseModel):
    id: str
    block_name: str
    category: FurnitureCategory
    insertion_point: Point2D
    rotation_deg: float
    scale_x: float
    scale_y: float
    source_entity_handle: str
    # (width, depth) in mm — from block extents in a real ezdxf-based
    # parser; category-informed defaults in this stdlib-only MVP parser
    # (see app/services/ingest.py).
    footprint_mm: tuple[float, float] = (600.0, 600.0)
    room_id: Optional[str] = None
    # 1 = exact override, 2 = pattern match, 3 = generic fallback
    # (see app/services/block_mapper.py).
    mapping_stage: int = 3


class TextLabel(BaseModel):
    id: str
    text: str
    position: Point2D
    height_mm: float
    rotation_deg: float
    role: LabelRole = LabelRole.GENERAL_ANNOTATION


class ParseWarning(BaseModel):
    code: str
    message: str
    severity: str = "warning"  # "info" | "warning"
    related_entity_handle: Optional[str] = None


class Provenance(BaseModel):
    original_filename: str
    source_format: str
    parsed_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    parser_version: str = "sprint2-stdlib-0.2.0"
    insunits_raw: int = 4  # DXF header default: 4 = millimeters


class FloorPlanIR(BaseModel):
    plan_id: str
    provenance: Provenance
    walls: list[Wall] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    rooms: list[Room] = Field(default_factory=list)
    furniture: list[FurnitureItem] = Field(default_factory=list)
    labels: list[TextLabel] = Field(default_factory=list)
    warnings: list[ParseWarning] = Field(default_factory=list)
    schema_version: str = SCHEMA_VERSION

    def bounds(self) -> tuple[float, float, float, float]:
        """Overall drawing extent across walls + rooms. (min_x, min_y, max_x, max_y)."""
        xs_min: list[float] = []
        ys_min: list[float] = []
        xs_max: list[float] = []
        ys_max: list[float] = []
        for w in self.walls:
            b = w.centerline.bounds()
            xs_min.append(b[0]); ys_min.append(b[1]); xs_max.append(b[2]); ys_max.append(b[3])
        for r in self.rooms:
            b = r.boundary.bounds()
            xs_min.append(b[0]); ys_min.append(b[1]); xs_max.append(b[2]); ys_max.append(b[3])
        if not xs_min:
            return (0.0, 0.0, 1000.0, 1000.0)
        return (min(xs_min), min(ys_min), max(xs_max), max(ys_max))


def new_id(prefix: str, counter: int) -> str:
    return f"{prefix}-{counter:04d}"
