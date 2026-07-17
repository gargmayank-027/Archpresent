"""
cad_service/ingest.py

Combines the entity-extractor + ir_builder modules from the architecture
doc (M04-M13) into one file for MVP scope. Each extraction concern is
still a clearly separated function so splitting into separate files later
(units.py, entity_extractors/walls.py, etc.) is a mechanical move, not a
rewrite.
"""

from __future__ import annotations

from cad_service.dxf_parser import (
    RawDxfDocument, RawEntity,
    lwpolyline_vertices, lwpolyline_is_closed, line_endpoints,
    insert_transform, text_value,
)
from cad_service.layer_map import (
    resolve_layer_role,
    ROLE_WALL, ROLE_DOOR, ROLE_WINDOW, ROLE_FURNITURE,
    ROLE_ROOM_LABEL, ROLE_ROOM_BOUNDARY,
)
from cad_service.block_mapper import map_block, classify_opening_kind
from cad_service.room_classifier import classify_room
from cad_service.ir_models import (
    FloorPlanIR, Wall, Opening, OpeningKind, Room, FurnitureItem, TextLabel,
    Point2D, Polyline, Provenance, ParseWarning, new_id, RoomType, LabelRole,
)

# ── Units normalization (M04) ───────────────────────────────────────────

_INSUNITS_TO_MM = {
    0: 1.0,     # unitless — assume mm, warn
    1: 25.4,    # inches
    2: 304.8,   # feet
    4: 1.0,     # millimeters
    5: 10.0,    # centimeters
    6: 1000.0,  # meters
}


def units_factor(insunits: int, warnings: list[ParseWarning]) -> float:
    factor = _INSUNITS_TO_MM.get(insunits)
    if factor is None:
        warnings.append(ParseWarning(
            code="unrecognized_insunits",
            message=f"Unrecognized $INSUNITS value {insunits} — assuming millimeters.",
            severity="warning",
        ))
        return 1.0
    if insunits == 0:
        warnings.append(ParseWarning(
            code="unitless_insunits",
            message="Drawing has no declared units ($INSUNITS=0) — assuming millimeters.",
            severity="warning",
        ))
    return factor


# ── Furniture footprint estimation ───────────────────────────────────────
# Without ezdxf's block-definition lookup, real block extents aren't
# available in this MVP parser. We use category-informed default
# footprints (in mm) as a documented stand-in — production ezdxf-based
# parsing reads the actual INSERT'd block's bounding box instead.

_DEFAULT_FOOTPRINT_MM: dict[str, tuple[float, float]] = {
    "bed": (1000, 2000), "queen_bed": (1500, 2000), "king_bed": (1800, 2000),
    "sofa": (2000, 900), "armchair": (800, 800), "dining_table": (1600, 900),
    "dining_chair": (450, 450), "coffee_table": (1000, 500), "tv_unit": (1400, 400),
    "wardrobe": (1800, 600), "desk": (1200, 600), "kitchen_counter": (2000, 600),
    "sink": (600, 500), "wc": (400, 650), "bathtub": (1700, 750), "generic": (600, 600),
}


def _extract_walls(entities: list[RawEntity], factor: float, overrides: dict | None,
                    warnings: list[ParseWarning]) -> list[Wall]:
    walls: list[Wall] = []
    counter = 0
    for e in entities:
        layer = e.get(8, "0")
        role = resolve_layer_role(layer, overrides)
        if role != ROLE_WALL:
            continue
        if e.dxftype == "LINE":
            (x0, y0), (x1, y1) = line_endpoints(e)
            pts = [Point2D(x0 * factor, y0 * factor), Point2D(x1 * factor, y1 * factor)]
        elif e.dxftype == "LWPOLYLINE":
            raw_pts = lwpolyline_vertices(e)
            pts = [Point2D(x * factor, y * factor) for x, y in raw_pts]
        else:
            continue
        if len(pts) < 2:
            continue
        counter += 1
        walls.append(Wall(
            id=new_id("wall", counter),
            centerline=Polyline(points=pts, closed=lwpolyline_is_closed(e) if e.dxftype == "LWPOLYLINE" else False),
            thickness_mm=150.0,  # MVP default — production ezdxf path reads dual-line offset or wall-object width
            layer=layer,
            source_entity_handle=e.get(5, ""),
        ))
    return walls


def _extract_openings(entities: list[RawEntity], factor: float, overrides: dict | None) -> list[Opening]:
    openings: list[Opening] = []
    counter = 0
    for e in entities:
        if e.dxftype != "INSERT":
            continue
        layer = e.get(8, "0")
        role = resolve_layer_role(layer, overrides)
        t = insert_transform(e)
        kind = classify_opening_kind(t["block_name"])
        if role not in (ROLE_DOOR, ROLE_WINDOW) and kind is None:
            continue
        if kind is None:
            kind = OpeningKind.DOOR if role == ROLE_DOOR else OpeningKind.WINDOW
        counter += 1
        openings.append(Opening(
            id=new_id("opening", counter),
            kind=kind,
            wall_id=None,  # MVP: not resolved to a specific wall segment
            position=Point2D(t["x"] * factor, t["y"] * factor),
            width_mm=900.0 * abs(t["x_scale"] or 1.0),
            rotation_deg=t["rotation_deg"],
            block_name=t["block_name"],
            source_entity_handle=e.get(5, ""),
        ))
    return openings


def _extract_furniture(entities: list[RawEntity], factor: float, overrides: dict | None,
                        exact_overrides: dict | None) -> list[FurnitureItem]:
    items: list[FurnitureItem] = []
    counter = 0
    for e in entities:
        if e.dxftype != "INSERT":
            continue
        layer = e.get(8, "0")
        role = resolve_layer_role(layer, overrides)
        t = insert_transform(e)
        if classify_opening_kind(t["block_name"]) is not None:
            continue  # already handled as an opening
        if role != ROLE_FURNITURE:
            continue
        category, stage = map_block(t["block_name"], exact_overrides)
        footprint = _DEFAULT_FOOTPRINT_MM.get(category.value, (600.0, 600.0))
        counter += 1
        items.append(FurnitureItem(
            id=new_id("furn", counter),
            block_name=t["block_name"],
            category=category,
            insertion_point=Point2D(t["x"] * factor, t["y"] * factor),
            rotation_deg=t["rotation_deg"],
            scale_x=t["x_scale"] or 1.0,
            scale_y=t["y_scale"] or 1.0,
            source_entity_handle=e.get(5, ""),
            footprint_mm=footprint,
            mapping_stage=stage,
        ))
    return items


def _extract_labels(entities: list[RawEntity], factor: float, overrides: dict | None) -> list[TextLabel]:
    labels: list[TextLabel] = []
    counter = 0
    for e in entities:
        if e.dxftype not in ("TEXT", "MTEXT"):
            continue
        layer = e.get(8, "0")
        role = resolve_layer_role(layer, overrides)
        text = text_value(e)
        if not text:
            continue
        counter += 1
        labels.append(TextLabel(
            id=new_id("label", counter),
            text=text,
            position=Point2D(e.get_float(10) * factor, e.get_float(20) * factor),
            height_mm=e.get_float(40, 2.5) * factor,
            rotation_deg=e.get_float(50, 0.0),
            role=LabelRole.ROOM_NAME if role == ROLE_ROOM_LABEL else LabelRole.GENERAL_ANNOTATION,
        ))
    return labels


def _extract_room_boundaries(entities: list[RawEntity], factor: float, overrides: dict | None) -> list[Polyline]:
    boundaries: list[Polyline] = []
    for e in entities:
        if e.dxftype != "LWPOLYLINE":
            continue
        layer = e.get(8, "0")
        role = resolve_layer_role(layer, overrides)
        if role != ROLE_ROOM_BOUNDARY:
            continue
        if not lwpolyline_is_closed(e):
            continue
        pts = [Point2D(x * factor, y * factor) for x, y in lwpolyline_vertices(e)]
        if len(pts) >= 3:
            boundaries.append(Polyline(points=pts, closed=True))
    return boundaries


def _shoelace_area_sqm(poly: Polyline) -> float:
    pts = poly.points
    if len(pts) < 3:
        return 0.0
    area = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i].x, pts[i].y
        x1, y1 = pts[(i + 1) % n].x, pts[(i + 1) % n].y
        area += x0 * y1 - x1 * y0
    return abs(area) / 2.0 / 1_000_000.0  # mm^2 -> m^2


def _point_in_polygon(pt: Point2D, poly: Polyline) -> bool:
    x, y = pt.x, pt.y
    pts = poly.points
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i].x, pts[i].y
        xj, yj = pts[j].x, pts[j].y
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _build_rooms(boundaries: list[Polyline], labels: list[TextLabel],
                  overall_bounds: tuple[float, float, float, float],
                  warnings: list[ParseWarning]) -> list[Room]:
    rooms: list[Room] = []
    if not boundaries:
        # Documented V1 MVP fallback (see README.md) — no wall-graph
        # polygonization without shapely, and no explicit room-boundary
        # polylines found. Whole-plan single room, never invented subdivisions.
        min_x, min_y, max_x, max_y = overall_bounds
        pts = [Point2D(min_x, min_y), Point2D(max_x, min_y), Point2D(max_x, max_y), Point2D(min_x, max_y)]
        boundary = Polyline(points=pts, closed=True)
        warnings.append(ParseWarning(
            code="no_room_boundaries_found",
            message="No explicit room-boundary polylines found on a room_boundary-mapped layer — "
                    "falling back to a single whole-plan room. Add closed polylines on a layer "
                    "like A-AREA/ROOM to get per-room boundaries.",
            severity="warning",
        ))
        rooms.append(Room(id=new_id("room", 1), boundary=boundary, area_sqm=_shoelace_area_sqm(boundary)))
        return rooms

    for i, boundary in enumerate(boundaries, start=1):
        # Associate the nearest contained label (point-in-polygon test, M10).
        label_text = None
        for label in labels:
            if label.role == LabelRole.ROOM_NAME and _point_in_polygon(label.position, boundary):
                label_text = label.text
                break
        room_type, confidence = classify_room(label_text)
        rooms.append(Room(
            id=new_id("room", i),
            boundary=boundary,
            area_sqm=_shoelace_area_sqm(boundary),
            room_type=room_type,
            label_text=label_text,
            classification_confidence=confidence,
        ))
    return rooms


def build_ir(raw: RawDxfDocument, original_filename: str,
             layer_overrides: dict | None = None,
             block_overrides: dict | None = None) -> FloorPlanIR:
    warnings = list(raw.warnings)
    factor = units_factor(raw.insunits, warnings)

    walls = _extract_walls(raw.entities, factor, layer_overrides, warnings)
    openings = _extract_openings(raw.entities, factor, layer_overrides)
    furniture = _extract_furniture(raw.entities, factor, layer_overrides, block_overrides)
    labels = _extract_labels(raw.entities, factor, layer_overrides)
    boundaries = _extract_room_boundaries(raw.entities, factor, layer_overrides)

    # Overall bounds for the whole-plan fallback room + SVG viewBox.
    all_pts: list[Point2D] = []
    for w in walls:
        all_pts.extend(w.centerline.points)
    for b in boundaries:
        all_pts.extend(b.points)
    if all_pts:
        xs = [p.x for p in all_pts]
        ys = [p.y for p in all_pts]
        overall_bounds = (min(xs), min(ys), max(xs), max(ys))
    else:
        overall_bounds = (0.0, 0.0, 5000.0, 5000.0)
        warnings.append(ParseWarning(
            code="empty_drawing",
            message="No wall or room-boundary geometry found in the DXF.",
            severity="warning",
        ))

    rooms = _build_rooms(boundaries, labels, overall_bounds, warnings)

    # Low-confidence furniture-mapping visibility (architecture doc §5.2).
    for item in furniture:
        if item.mapping_stage == 3:
            warnings.append(ParseWarning(
                code="unmapped_furniture_block",
                message=f"Block '{item.block_name}' did not match any known furniture pattern — "
                        f"rendered with the generic placeholder symbol.",
                severity="info",
                related_entity_handle=item.source_entity_handle,
            ))

    return FloorPlanIR(
        plan_id=new_id("plan", 1),
        provenance=Provenance(original_filename=original_filename, source_format="dxf",
                               insunits_raw=raw.insunits),
        walls=walls,
        openings=openings,
        rooms=rooms,
        furniture=furniture,
        labels=labels,
        warnings=warnings,
    )
