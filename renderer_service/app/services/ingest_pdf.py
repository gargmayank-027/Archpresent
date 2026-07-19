"""
app/services/ingest_pdf.py

Assembles the full `FloorPlanIR` (app/models/floorplan.py — the SAME
frozen IR the DXF engine produces; nothing here forks or extends the
schema) from a PDF's vector geometry. Mirrors `ingest.py`'s `build_ir`
shape closely on purpose, and reuses two DXF-engine modules verbatim
because they're genuinely source-agnostic:

  - `app/services/wall_graph.py` — derives closed room polygons from
    plain line segments. It has no idea whether those segments came
    from a DXF LINE/LWPOLYLINE or a PDF vector stroke, so this module
    feeds it the exact same shape of input the DXF path does.
  - `app/services/room_classifier.py` — label text -> RoomType. Its own
    docstring already anticipates this: "a CAD-origin room and an
    image-origin room classify identically for the same label text."

V1 scope (vector PDFs only — see pdf_router.py):
  - Walls: recovered from stroke geometry (pdf_geometry.py).
  - Openings: wall-gap candidates, all emitted as OpeningKind.DOOR (the
    more common case) with an explicit warning that door/window are not
    yet distinguished from vector geometry alone (needs arc/double-line
    detection — a real V2 enhancement, not attempted here).
  - Rooms: wall-graph derivation only (tier 2 of ingest.py's three-tier
    approach) then the same honest whole-plan fallback (tier 3). Tier 1
    (explicit room-boundary polylines on a dedicated layer) has no PDF
    equivalent — a PDF has no layer system, so a "room boundary
    rectangle" is visually indistinguishable from a wall or a furniture
    box without much more work. Skipping it rather than guessing wrong.
  - Furniture: none in V1 — needs the raster/detection pipeline (a
    future slice, see the PDF/Image engine design doc), not attempted
    from vector geometry alone. Always an empty list, never guessed.

Required-but-DXF-specific IR fields (`layer`, `source_entity_handle`,
`block_name`) are populated with fixed, honest placeholder values (see
`_VECTOR_LAYER` / `_NO_HANDLE` below) rather than left blank silently —
`Provenance.source_format="pdf_vector"` is what actually tells a
consumer (or a future dashboard) this record didn't come from a DXF.
"""

from __future__ import annotations

import logging

from app.models.floorplan import (
    FloorPlanIR, Wall, Opening, OpeningKind, Room, TextLabel,
    Point2D, Polyline, Provenance, ParseWarning, LabelRole, new_id,
)
from app.services.pdf_vector_extract import PageGeometry
from app.services.pdf_geometry import GeometryConfig, GeometryResult, reconstruct
from app.services.pdf_scale import scale_factor_mm_per_pt
from app.services.room_classifier import classify_room
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

from app.services.wall_graph import derive_room_polygons, rooms_pass_sanity_check
from app.utils.geometry import shoelace_area_sqm, point_in_polygon

logger = logging.getLogger(__name__)

# Fixed placeholders for IR fields that only mean something for a DXF
# source (layer name, CAD entity handle, INSERT block name). Kept as
# named constants rather than inline literals so their meaning is
# grep-able from anywhere they're used.
_VECTOR_LAYER = "pdf-vector"
_NO_HANDLE = ""
_NO_BLOCK = ""

# The gap wall_graph.derive_room_polygons() will bridge (e.g. a wall's two
# parallel face-lines drawn a couple of points apart, or minor drafting
# imprecision at a T-junction) is a FIXED, scale-independent property of
# how the drawing was actually drafted at the page level — it does NOT
# get bigger or smaller just because a different scale_override is
# guessed. Expressing the tolerance directly in millimetres (as a single
# fixed post-scale constant) breaks this: the SAME raw-page gap ends up
# wildly over- or under-bridged depending purely on which scale happened
# to be entered (a 1:10 guess made a 50mm tolerance too generous and
# fragmented the plan into ~90 sliver "rooms"; a 1:100 guess made the
# same 50mm too tight to bridge real gaps at all, fragmenting the wall
# graph badly enough to time out). Expressing it in raw PDF POINTS
# instead, then scaling by the same `factor` used everywhere else, keeps
# the bridged gap consistent in the drawing's own terms regardless of
# which scale is guessed — topology (room count/shapes) becomes
# scale-invariant; only the resulting real-world size still depends on
# getting the actual scale right, which no tolerance choice can fix.
# Starting value, not yet tuned against a properly-scaled real file.
_SNAP_TOLERANCE_PT = 4.0

# wall_graph.derive_room_polygons() is existing DXF-engine code (see its
# own module docstring) with O(n^2)-or-worse steps that were only ever
# validated against "hundreds" of walls / one real messy file. A real,
# complex vector-PDF plan can produce enough wall segments (and, after
# intersection-splitting, far more points) to make it hang for minutes
# rather than seconds. Rather than risk the whole request hanging
# indefinitely, room detection gets a hard wall-clock budget — if it
# doesn't finish in time, we fall back to the honest whole-plan room
# (see _build_rooms below) instead of leaving the client waiting forever.
# This does NOT fix wall_graph.py's underlying complexity (shared,
# DXF-critical code — out of scope for a blind edit here); it just
# guarantees this endpoint always returns.
_ROOM_DETECTION_TIMEOUT_SECONDS = 20.0
_room_detection_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="pdf-room-detect")


def _extract_walls(result: GeometryResult, factor: float) -> list[Wall]:
    walls: list[Wall] = []
    for i, w in enumerate(result.walls, start=1):
        pts = [Point2D(x=w.x0 * factor, y=w.y0 * factor),
               Point2D(x=w.x1 * factor, y=w.y1 * factor)]
        walls.append(Wall(
            id=new_id("wall", i),
            centerline=Polyline(points=pts, closed=False),
            thickness_mm=max(w.thickness * factor, 50.0),  # floor: a 0-width
            # merged run shouldn't render as an invisible wall
            layer=_VECTOR_LAYER,
            source_entity_handle=_NO_HANDLE,
        ))
    logger.debug("Extracted %d walls from PDF vector geometry.", len(walls))
    return walls


def _extract_openings(result: GeometryResult, factor: float, warnings: list[ParseWarning]) -> list[Opening]:
    openings: list[Opening] = []
    for i, o in enumerate(result.openings, start=1):
        cx = (o.x0 + o.x1) / 2.0 * factor
        cy = (o.y0 + o.y1) / 2.0 * factor
        openings.append(Opening(
            id=new_id("opening", i),
            kind=OpeningKind.DOOR,  # best-guess default — see module docstring
            wall_id=None,
            position=Point2D(x=cx, y=cy),
            width_mm=o.width * factor,
            rotation_deg=0.0,
            block_name=_NO_BLOCK,
            source_entity_handle=_NO_HANDLE,
        ))
    if openings:
        warnings.append(ParseWarning(
            code="opening_kind_unresolved",
            message=f"{len(openings)} opening(s) were detected as gaps in wall geometry but could "
                    f"not be classified as door vs. window from vector geometry alone — all are "
                    f"reported as 'door'. Distinguishing them needs swing-arc/double-line detection "
                    f"(a planned enhancement), not attempted in this V1 vector-only pass.",
            severity="info",
        ))
    logger.debug("Extracted %d opening candidates from PDF vector geometry.", len(openings))
    return openings


_REPLACEMENT_CHAR = "\ufffd"


def _looks_like_garbage(text: str) -> bool:
    """True if `text` looks like it came from a PDF font with no usable
    /ToUnicode character map — a well-documented PDF phenomenon, common
    in CAD-exported PDFs (AutoCAD/Revit often embed subsetted fonts
    without one; see PyMuPDF's own FAQ on garbled/empty text extraction).
    Symptoms: literal U+FFFD replacement characters, or a majority of
    characters outside printable Latin text and common punctuation.

    Passing this text through unchanged would both (a) never match any
    room-type keyword, silently forcing every room to Unclassified, and
    (b) get drawn onto the rendered SVG as unreadable tofu-box glyphs —
    this filters both symptoms out at their single shared source instead
    of chasing them downstream. Recovering the real text would need OCR
    (rasterize the label's bounding box, run Tesseract) — out of scope
    for this vector-only V1; see the PDF/Image engine design doc's V2
    raster/CV scope.
    """
    if not text:
        return True
    if _REPLACEMENT_CHAR in text:
        return True
    printable = sum(1 for c in text if c.isprintable() and (c.isascii() or c in "°'\""))
    return printable < max(1, len(text) * 0.6)


def _extract_labels(geom: PageGeometry, factor: float, warnings: list[ParseWarning]) -> list[TextLabel]:
    labels: list[TextLabel] = []
    discarded_garbage_count = 0
    for i, t in enumerate(geom.texts, start=1):
        cx, cy = t.cx, t.cy
        if any(min(rx0, rx1) <= cx <= max(rx0, rx1) and min(ry0, ry1) <= cy <= max(ry0, ry1)
               for (rx0, ry0, rx1, ry1) in geom.excluded_regions):
            continue  # title block / legend region — see pdf_vector_extract._detect_title_block
        if _looks_like_garbage(t.text):
            discarded_garbage_count += 1
            continue
        labels.append(TextLabel(
            id=new_id("label", i),
            text=t.text,
            position=Point2D(x=t.x0 * factor, y=t.y0 * factor),
            height_mm=max((t.y1 - t.y0) * factor, 1.0),
            rotation_deg=0.0,
            # Every PDF text block is treated as a potential room-name
            # candidate for `_build_rooms`'s point-in-polygon match below —
            # there's no layer system to pre-classify "room label" vs.
            # "general annotation" the way a DXF layer can (see
            # layer_map.py); classify_room()'s own vocabulary match is
            # what ultimately decides whether it means anything.
            role=LabelRole.ROOM_NAME,
        ))
    if discarded_garbage_count:
        warnings.append(ParseWarning(
            code="unreadable_text_labels_discarded",
            message=f"{discarded_garbage_count} text label(s) on this page could not be read — the "
                    f"PDF's embedded font has no usable character mapping for them (common in "
                    f"CAD-exported PDFs). These labels were skipped rather than shown as garbled "
                    f"text; affected rooms may show as Unclassified. Recovering them needs OCR, not "
                    f"attempted in this V1.",
            severity="warning",
        ))
    return labels


def _build_rooms(walls: list[Wall], labels: list[TextLabel],
                  overall_bounds: tuple[float, float, float, float],
                  warnings: list[ParseWarning], factor: float) -> list[Room]:
    """Two-tier room detection (see module docstring for why PDF has no
    tier-1 equivalent to ingest.py's explicit-boundary-polyline tier):
      1. Wall-graph derivation from the recovered wall centerlines —
         reuses `wall_graph.derive_room_polygons` verbatim.
      2. Whole-plan single room — the same honest fallback ingest.py
         uses when wall-graph derivation isn't trustworthy either.
    """
    rooms: list[Room] = []

    if walls:
        wall_segments = []
        for w in walls:
            pts = [(p.x, p.y) for p in w.centerline.points]
            for i in range(len(pts) - 1):
                wall_segments.append((pts[i], pts[i + 1]))

        try:
            future = _room_detection_executor.submit(derive_room_polygons, wall_segments, _SNAP_TOLERANCE_PT * factor)
            derived = future.result(timeout=_ROOM_DETECTION_TIMEOUT_SECONDS)
        except FutureTimeoutError:
            logger.warning(
                "Wall-graph room detection timed out after %ss on %d wall segment(s) — "
                "falling back to whole-plan room. (Note: the computation keeps running in "
                "the background thread; it isn't cancelled, just abandoned.)",
                _ROOM_DETECTION_TIMEOUT_SECONDS, len(wall_segments),
            )
            warnings.append(ParseWarning(
                code="room_detection_timed_out",
                message=f"Automatic room detection took too long on this plan's "
                        f"{len(wall_segments)} wall segments and was abandoned after "
                        f"{_ROOM_DETECTION_TIMEOUT_SECONDS:.0f}s — showing the whole-plan outline "
                        f"instead of individual rooms. This plan's wall geometry may be unusually "
                        f"dense or fragmented for automatic detection.",
                severity="warning",
            ))
            derived = []

        if derived and rooms_pass_sanity_check(derived, overall_bounds):
            logger.info("Wall-graph room detection succeeded: %d rooms (PDF vector source).", len(derived))
            for i, poly_pts in enumerate(derived, start=1):
                boundary = Polyline(points=[Point2D(x=x, y=y) for x, y in poly_pts], closed=True)
                label_text = None
                for label in labels:
                    if point_in_polygon((label.position.x, label.position.y), poly_pts):
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
                message=f"{len(rooms)} room(s) were derived from vector wall geometry via the same "
                        f"wall-graph algorithm the DXF engine uses. Verify boundaries look correct.",
                severity="info",
            ))
            return rooms
        elif derived:
            logger.warning(
                "PDF wall-graph room detection found %d candidate room(s) but failed the sanity "
                "check — falling back to whole-plan room.", len(derived),
            )
            warnings.append(ParseWarning(
                code="wall_graph_detection_rejected",
                message="Wall geometry was found, but the recovered wall network has gaps at scales "
                        "too inconsistent to reliably split into rooms automatically — falling back "
                        "to a single whole-plan room rather than guessing.",
                severity="warning",
            ))

    min_x, min_y, max_x, max_y = overall_bounds
    pts = [Point2D(x=min_x, y=min_y), Point2D(x=max_x, y=min_y),
           Point2D(x=max_x, y=max_y), Point2D(x=min_x, y=max_y)]
    boundary = Polyline(points=pts, closed=True)
    if not walls:
        warnings.append(ParseWarning(
            code="no_room_boundaries_found",
            message="No wall geometry was recovered from this PDF's vector paths — falling back to "
                    "a single whole-plan room.",
            severity="warning",
        ))
    area = shoelace_area_sqm([(p.x, p.y) for p in boundary.points])
    rooms.append(Room(id=new_id("room", 1), boundary=boundary, area_sqm=area))
    return rooms


def build_ir_from_geometry(
    geom: PageGeometry,
    original_filename: str,
    scale_override: str | None = None,
    geometry_cfg: GeometryConfig | None = None,
) -> FloorPlanIR:
    """Pure function of its inputs — no I/O, no global state, fully
    unit-testable (see tests/test_ingest_pdf.py). This is the function
    to call once vector geometry has already been extracted (via
    pdf_vector_extract.extract_page_geometry, or a hand-built
    PageGeometry in tests)."""
    warnings: list[ParseWarning] = []
    factor = scale_factor_mm_per_pt(scale_override, warnings)

    result = reconstruct(geom, geometry_cfg)
    for w in result.warnings:
        warnings.append(ParseWarning(code="vector_geometry_warning", message=w, severity="info"))

    walls = _extract_walls(result, factor)
    openings = _extract_openings(result, factor, warnings)
    labels = _extract_labels(geom, factor, warnings)

    all_pts: list[Point2D] = []
    for w in walls:
        all_pts.extend(w.centerline.points)
    if all_pts:
        xs = [p.x for p in all_pts]
        ys = [p.y for p in all_pts]
        overall_bounds = (min(xs), min(ys), max(xs), max(ys))
    else:
        overall_bounds = (0.0, 0.0, geom.page_width_pt * factor, geom.page_height_pt * factor)
        warnings.append(ParseWarning(
            code="empty_drawing",
            message="No wall or room geometry found in this PDF's vector paths.",
            severity="warning",
        ))

    rooms = _build_rooms(walls, labels, overall_bounds, warnings, factor)

    ir = FloorPlanIR(
        plan_id=new_id("plan", 1),
        provenance=Provenance(
            original_filename=original_filename,
            source_format="pdf_vector",
        ),
        walls=walls,
        openings=openings,
        rooms=rooms,
        furniture=[],  # not attempted from vector geometry alone — see module docstring
        labels=labels,
        warnings=warnings,
    )
    logger.info(
        "Built PDF-vector IR: %d rooms, %d walls, %d openings, %d warnings.",
        len(rooms), len(walls), len(openings), len(warnings),
    )
    return ir


def build_ir_from_pdf_bytes(
    data: bytes,
    original_filename: str,
    page_index: int = 0,
    scale_override: str | None = None,
) -> FloorPlanIR:
    """Full entrypoint: raw PDF bytes -> FloorPlanIR. Needs PyMuPDF
    (imported only inside pdf_vector_extract, so this function is the
    first one in the ingest_pdf module that actually requires it)."""
    from app.services.pdf_vector_extract import extract_page_geometry
    geom = extract_page_geometry(data, page_index)
    return build_ir_from_geometry(geom, original_filename, scale_override)
