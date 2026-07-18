"""
app/services/ingest.py

Entity extraction + IR assembly. Ported from cad_service/ingest.py,
updated to build pydantic IR models (app/models/floorplan.py) and to use
the shared geometry helpers in app/utils/geometry.py instead of private
duplicated functions.
"""

from __future__ import annotations

import logging

from app.models.floorplan import (
    FloorPlanIR, Wall, Opening, OpeningKind, Room, FurnitureItem, TextLabel,
    Point2D, Polyline, Provenance, ParseWarning, new_id, LabelRole,
)
from app.services.dxf_parser import (
    RawDxfDocument, RawEntity,
    lwpolyline_vertices, lwpolyline_is_closed, line_endpoints,
    insert_transform, text_value,
)
from app.services.layer_map import (
    resolve_layer_role,
    ROLE_WALL, ROLE_DOOR, ROLE_WINDOW, ROLE_FURNITURE,
    ROLE_ROOM_LABEL, ROLE_ROOM_BOUNDARY,
)
from app.services.block_mapper import map_block, classify_opening_kind
from app.services.room_classifier import classify_room
from app.services.units import units_factor
from app.services.wall_graph import derive_room_polygons, rooms_pass_sanity_check
from app.utils.geometry import shoelace_area_sqm, point_in_polygon

logger = logging.getLogger(__name__)

# Category-informed default footprints (mm) — see FurnitureItem.footprint_mm
# docstring for why these are defaults rather than measured block extents
# in this stdlib-only parser.
_DEFAULT_FOOTPRINT_MM: dict[str, tuple[float, float]] = {
    "bed": (1000, 2000), "queen_bed": (1500, 2000), "king_bed": (1800, 2000),
    "sofa": (2000, 900), "armchair": (800, 800), "dining_table": (1600, 900),
    "dining_chair": (450, 450), "coffee_table": (1000, 500), "tv_unit": (1400, 400),
    "wardrobe": (1800, 600), "desk": (1200, 600), "kitchen_counter": (2000, 600),
    "sink": (600, 500), "wc": (400, 650), "bathtub": (1700, 750), "generic": (600, 600),
}


def _extract_walls(entities: list[RawEntity], factor: float, overrides: dict | None) -> list[Wall]:
    walls: list[Wall] = []
    counter = 0
    for e in entities:
        layer = e.get(8, "0")
        if resolve_layer_role(layer, overrides) != ROLE_WALL:
            continue
        if e.dxftype == "LINE":
            (x0, y0), (x1, y1) = line_endpoints(e)
            pts = [Point2D(x=x0 * factor, y=y0 * factor), Point2D(x=x1 * factor, y=y1 * factor)]
            closed = False
        elif e.dxftype == "LWPOLYLINE":
            raw_pts = lwpolyline_vertices(e)
            pts = [Point2D(x=x * factor, y=y * factor) for x, y in raw_pts]
            closed = lwpolyline_is_closed(e)
        else:
            continue
        if len(pts) < 2:
            continue
        counter += 1
        walls.append(Wall(
            id=new_id("wall", counter),
            centerline=Polyline(points=pts, closed=closed),
            thickness_mm=150.0,  # MVP default — see README.md known limitations
            layer=layer,
            source_entity_handle=e.get(5, ""),
        ))
    logger.debug("Extracted %d walls.", len(walls))
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
            wall_id=None,  # not resolved to a specific wall segment in this MVP
            position=Point2D(x=t["x"] * factor, y=t["y"] * factor),
            width_mm=900.0 * abs(t["x_scale"] or 1.0),
            rotation_deg=t["rotation_deg"],
            block_name=t["block_name"],
            source_entity_handle=e.get(5, ""),
        ))
    logger.debug("Extracted %d openings.", len(openings))
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
            insertion_point=Point2D(x=t["x"] * factor, y=t["y"] * factor),
            rotation_deg=t["rotation_deg"],
            scale_x=t["x_scale"] or 1.0,
            scale_y=t["y_scale"] or 1.0,
            source_entity_handle=e.get(5, ""),
            footprint_mm=footprint,
            mapping_stage=stage,
        ))
    logger.debug("Extracted %d furniture items.", len(items))
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
            position=Point2D(x=e.get_float(10) * factor, y=e.get_float(20) * factor),
            height_mm=e.get_float(40, 2.5) * factor,
            rotation_deg=e.get_float(50, 0.0),
            role=LabelRole.ROOM_NAME if role == ROLE_ROOM_LABEL else LabelRole.GENERAL_ANNOTATION,
        ))
    logger.debug("Extracted %d text labels.", len(labels))
    return labels


def _extract_room_boundaries(entities: list[RawEntity], factor: float, overrides: dict | None) -> list[Polyline]:
    boundaries: list[Polyline] = []
    for e in entities:
        if e.dxftype != "LWPOLYLINE":
            continue
        layer = e.get(8, "0")
        if resolve_layer_role(layer, overrides) != ROLE_ROOM_BOUNDARY:
            continue
        if not lwpolyline_is_closed(e):
            continue
        pts = [Point2D(x=x * factor, y=y * factor) for x, y in lwpolyline_vertices(e)]
        if len(pts) >= 3:
            boundaries.append(Polyline(points=pts, closed=True))
    return boundaries


def _build_rooms(boundaries: list[Polyline], labels: list[TextLabel],
                  walls: list[Wall],
                  overall_bounds: tuple[float, float, float, float],
                  warnings: list[ParseWarning]) -> list[Room]:
    """
    Three-tier room detection, most-precise first:
      1. Explicit closed room-boundary polylines (e.g. on an A-AREA
         layer) — exact, when present.
      2. Wall-graph derivation (app/services/wall_graph.py) — works from
         real wall geometry alone, which is what most real architectural
         firms actually draw (explicit boundary polylines are rare in
         practice). Only trusted if it passes a sanity check; a
         still-under-connected wall network is rejected rather than
         shown as a wrong-but-confident split (see
         wall_graph.rooms_pass_sanity_check's docstring).
      3. Whole-plan single room — the honest fallback when neither of
         the above produced something trustworthy. Never invents room
         subdivisions.
    """
    rooms: list[Room] = []
    wall_graph_warning_added = False

    if boundaries:
        for i, boundary in enumerate(boundaries, start=1):
            label_text = None
            for label in labels:
                if label.role == LabelRole.ROOM_NAME and point_in_polygon(
                    (label.position.x, label.position.y), [(p.x, p.y) for p in boundary.points]
                ):
                    label_text = label.text
                    break
            room_type, confidence = classify_room(label_text)
            area = shoelace_area_sqm([(p.x, p.y) for p in boundary.points])
            rooms.append(Room(
                id=new_id("room", i),
                boundary=boundary,
                area_sqm=area,
                room_type=room_type,
                label_text=label_text,
                classification_confidence=confidence,
            ))
        return rooms

    if walls:
        wall_segments = []
        for w in walls:
            pts = [(p.x, p.y) for p in w.centerline.points]
            for i in range(len(pts) - 1):
                wall_segments.append((pts[i], pts[i + 1]))
            if w.centerline.closed and len(pts) > 2:
                wall_segments.append((pts[-1], pts[0]))

        derived = derive_room_polygons(wall_segments, snap_tolerance=50.0)
        if derived and rooms_pass_sanity_check(derived, overall_bounds):
            logger.info("Wall-graph room detection succeeded: %d rooms.", len(derived))
            for i, poly_pts in enumerate(derived, start=1):
                boundary = Polyline(points=[Point2D(x=x, y=y) for x, y in poly_pts], closed=True)
                label_text = None
                for label in labels:
                    if label.role == LabelRole.ROOM_NAME and point_in_polygon(
                        (label.position.x, label.position.y), poly_pts
                    ):
                        label_text = label.text
                        break
                room_type, confidence = classify_room(label_text)
                area = shoelace_area_sqm(poly_pts)
                rooms.append(Room(
                    id=new_id("room", i),
                    boundary=boundary,
                    area_sqm=area,
                    room_type=room_type,
                    label_text=label_text,
                    classification_confidence=confidence,
                ))
            warnings.append(ParseWarning(
                code="rooms_derived_from_wall_graph",
                message=f"No explicit room-boundary polylines found — {len(rooms)} room(s) were "
                        f"derived from wall geometry instead. Verify boundaries look correct; add "
                        f"explicit closed polylines on an A-AREA/ROOM layer for guaranteed precision.",
                severity="info",
            ))
            return rooms
        elif derived:
            # Found candidate faces, but they failed the sanity check —
            # genuinely fragmented/inconsistent wall network, distinct
            # from "there was nothing to work with" below.
            logger.warning(
                "Wall-graph room detection found %d candidate room(s) but failed the sanity "
                "check (wall network too fragmented/inconsistent to trust) — falling back to "
                "whole-plan room.", len(derived),
            )
            warnings.append(ParseWarning(
                code="wall_graph_detection_rejected",
                message="Wall geometry was found, but the wall network has gaps at scales too "
                        "inconsistent to reliably split into rooms automatically — falling back "
                        "to a single whole-plan room rather than guessing. Add explicit closed "
                        "polylines on an A-AREA/ROOM layer, or clean up wall endpoint gaps, for "
                        "per-room detection.",
                severity="warning",
            ))
            wall_graph_warning_added = True
        # else: derived == [] (not enough wall geometry to form any closed
        # loop at all) — falls straight through to the tier-3 message
        # below, which correctly describes this as "no boundaries found"
        # rather than "found but rejected".

    # Tier 3: honest whole-plan fallback. Never invents subdivisions.
    min_x, min_y, max_x, max_y = overall_bounds
    pts = [Point2D(x=min_x, y=min_y), Point2D(x=max_x, y=min_y),
           Point2D(x=max_x, y=max_y), Point2D(x=min_x, y=max_y)]
    boundary = Polyline(points=pts, closed=True)
    if not wall_graph_warning_added:
        logger.warning("No usable room-boundary geometry found — falling back to whole-plan room.")
        warnings.append(ParseWarning(
            code="no_room_boundaries_found",
            message="No explicit room-boundary polylines and no usable wall geometry found — "
                    "falling back to a single whole-plan room. Add closed polylines on a layer "
                    "like A-AREA/ROOM to get per-room boundaries.",
            severity="warning",
        ))
    area = shoelace_area_sqm([(p.x, p.y) for p in boundary.points])
    rooms.append(Room(id=new_id("room", 1), boundary=boundary, area_sqm=area))
    return rooms


def build_ir(raw: RawDxfDocument, original_filename: str,
             layer_overrides: dict | None = None,
             block_overrides: dict | None = None,
             unit_override: str | None = None) -> FloorPlanIR:
    """Assembles the full FloorPlanIR from a parsed RawDxfDocument. Pure
    function of its inputs — no I/O, no global state, fully unit-testable."""
    warnings = list(raw.warnings)
    factor = units_factor(raw.insunits, warnings, unit_override)

    walls = _extract_walls(raw.entities, factor, layer_overrides)
    openings = _extract_openings(raw.entities, factor, layer_overrides)
    furniture = _extract_furniture(raw.entities, factor, layer_overrides, block_overrides)
    labels = _extract_labels(raw.entities, factor, layer_overrides)
    boundaries = _extract_room_boundaries(raw.entities, factor, layer_overrides)

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
        logger.warning("No wall or room-boundary geometry found in the DXF.")
        warnings.append(ParseWarning(
            code="empty_drawing",
            message="No wall or room-boundary geometry found in the DXF.",
            severity="warning",
        ))

    rooms = _build_rooms(boundaries, labels, walls, overall_bounds, warnings)

    for item in furniture:
        if item.mapping_stage == 3:
            warnings.append(ParseWarning(
                code="unmapped_furniture_block",
                message=f"Block '{item.block_name}' did not match any known furniture pattern — "
                        f"rendered with the generic placeholder symbol.",
                severity="info",
                related_entity_handle=item.source_entity_handle,
            ))

    ir = FloorPlanIR(
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
    logger.info(
        "Built IR: %d rooms, %d walls, %d openings, %d furniture, %d warnings.",
        len(rooms), len(walls), len(openings), len(furniture), len(warnings),
    )
    return ir
