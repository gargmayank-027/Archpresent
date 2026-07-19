"""
app/services/pdf_geometry.py

Turns raw stroked segments (see pdf_vector_extract.py) into wall
centerline segments and opening-gap candidates. Pure Python, no PyMuPDF
— unit-testable directly (tests/test_pdf_geometry.py) with hand-built
`RawSegment` lists, the same isolation `dxf_parser.py`'s group-code
reader gets from `ingest.py`.

Room *boundaries* are deliberately NOT derived here — that's
`app/services/wall_graph.py`'s job (already built for the DXF engine,
and genuinely source-agnostic: it works from plain line segments, so
`ingest_pdf.py` feeds these wall segments into the exact same
`derive_room_polygons()` the DXF path uses, rather than this module
reimplementing room detection).

All thresholds live in `GeometryConfig` rather than as magic constants,
so fusion can be retuned without editing this module — same pattern as
`GeometryConfig`-style config objects elsewhere in this codebase.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple

from app.services.pdf_vector_extract import PageGeometry, RawSegment


@dataclass
class GeometryConfig:
    # Walls are the thicker cluster of strokes; dimension lines, leaders,
    # and hatching are thinner. When there's a clear thickness spread
    # (max >= min * bimodal_ratio), the split threshold is the geometric
    # mean of min and max stroke width — NOT a multiple of the median,
    # which breaks when walls are the majority of segments (then the
    # median IS the wall width, and nothing clears "median * factor").
    bimodal_ratio: float = 2.0
    # When stroke widths are ~uniform (no thick/thin distinction), fall
    # back to: long axis-aligned runs are structural.
    min_wall_length_ratio: float = 0.04  # fraction of page diagonal
    # Endpoint-snapping tolerance for merging colinear runs (page points).
    snap_tol: float = 2.0
    # Gap between two colinear structural segments smaller than this is
    # just a rendering seam (merge through it); larger (but below
    # max_opening_gap) is a candidate door/window opening.
    merge_gap: float = 3.0
    max_opening_gap: float = 60.0


@dataclass
class WallSeg:
    x0: float
    y0: float
    x1: float
    y1: float
    thickness: float


@dataclass
class OpeningCandidate:
    x0: float
    y0: float
    x1: float
    y1: float
    width: float


@dataclass
class GeometryResult:
    walls: List[WallSeg] = field(default_factory=list)
    openings: List[OpeningCandidate] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def _in_excluded(x: float, y: float, regions) -> bool:
    for (rx0, ry0, rx1, ry1) in regions:
        if min(rx0, rx1) <= x <= max(rx0, rx1) and min(ry0, ry1) <= y <= max(ry0, ry1):
            return True
    return False


def classify_structural_segments(
    segments: List[RawSegment], page_diag: float, cfg: GeometryConfig
) -> List[RawSegment]:
    """Keep segments likely to be walls; drop thin annotation/dimension
    lines. Filled paths (solid poche walls) are always structural."""
    if not segments:
        return []
    widths = [s.width for s in segments if s.width > 0] or [1.0]
    w_min, w_max = min(widths), max(widths)
    length_threshold = page_diag * cfg.min_wall_length_ratio

    bimodal = w_max >= w_min * cfg.bimodal_ratio
    width_threshold = (w_min * w_max) ** 0.5 if bimodal else None

    structural: List[RawSegment] = []
    for s in segments:
        if s.is_fill:
            structural.append(s)
            continue
        if width_threshold is not None:
            if s.width >= width_threshold:
                structural.append(s)
        else:
            if (s.is_horizontal or s.is_vertical) and s.length >= length_threshold:
                structural.append(s)
    return structural


def merge_colinear(
    segments: List[RawSegment], cfg: GeometryConfig
) -> Tuple[List[WallSeg], List[OpeningCandidate]]:
    """Merge colinear, near-touching axis-aligned segments into wall
    runs. A gap between two colinear structural segments larger than
    `merge_gap` but smaller than `max_opening_gap` becomes an opening
    candidate (a door/window interrupts the wall run)."""
    horiz: dict = {}
    vert: dict = {}

    def bucket(key: float) -> float:
        return round(key / max(cfg.snap_tol, 1e-6)) * cfg.snap_tol

    for s in segments:
        if s.is_horizontal:
            y = bucket((s.y0 + s.y1) / 2.0)
            horiz.setdefault(y, []).append((min(s.x0, s.x1), max(s.x0, s.x1), s.width))
        elif s.is_vertical:
            x = bucket((s.x0 + s.x1) / 2.0)
            vert.setdefault(x, []).append((min(s.y0, s.y1), max(s.y0, s.y1), s.width))
        # angled segments are ignored (caller warns)

    walls: List[WallSeg] = []
    openings: List[OpeningCandidate] = []

    def process(axis_map: dict, horizontal: bool):
        for coord, spans in axis_map.items():
            spans.sort()
            cur_lo, cur_hi, cur_w = spans[0]
            for lo, hi, w in spans[1:]:
                gap = lo - cur_hi
                if gap <= cfg.merge_gap:
                    cur_hi = max(cur_hi, hi)
                    cur_w = max(cur_w, w)
                else:
                    if gap <= cfg.max_opening_gap:
                        if horizontal:
                            openings.append(OpeningCandidate(cur_hi, coord, lo, coord, gap))
                        else:
                            openings.append(OpeningCandidate(coord, cur_hi, coord, lo, gap))
                    if horizontal:
                        walls.append(WallSeg(cur_lo, coord, cur_hi, coord, cur_w))
                    else:
                        walls.append(WallSeg(coord, cur_lo, coord, cur_hi, cur_w))
                    cur_lo, cur_hi, cur_w = lo, hi, w
            if horizontal:
                walls.append(WallSeg(cur_lo, coord, cur_hi, coord, cur_w))
            else:
                walls.append(WallSeg(coord, cur_lo, coord, cur_hi, cur_w))

    process(horiz, True)
    process(vert, False)
    return walls, openings


def reconstruct(geom: PageGeometry, cfg: GeometryConfig | None = None) -> GeometryResult:
    cfg = cfg or GeometryConfig()
    result = GeometryResult()

    page_diag = (geom.page_width_pt ** 2 + geom.page_height_pt ** 2) ** 0.5

    angled = [s for s in geom.segments if not (s.is_horizontal or s.is_vertical)]
    if angled:
        result.warnings.append(
            f"{len(angled)} angled/curved segment(s) ignored — this V1 vector path handles "
            f"orthogonal (straight, axis-aligned) walls only."
        )

    structural = classify_structural_segments(geom.segments, page_diag, cfg)
    walls, openings = merge_colinear(structural, cfg)
    walls = [w for w in walls
             if not _in_excluded((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, geom.excluded_regions)]
    result.walls = walls
    result.openings = openings

    if not walls:
        result.warnings.append(
            "No wall geometry recovered from this page's vector paths — the drawing may use "
            "unusually thin/uniform line weights, or the plan content may actually be raster."
        )
    return result
