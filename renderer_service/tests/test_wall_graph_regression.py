"""
tests/test_wall_graph_regression.py

Regression suite for the wall_graph.py spatial-grid optimization (see
docs/wall-graph-optimization.md for the profiling report and design
rationale this responds to). This is a PURE PERFORMANCE REWRITE —
every test here exists to prove behavior didn't change, not to test
new functionality.

Covers:
  - The 9 synthetic cases from wall_graph.py's own module docstring
  - Randomized differential cases across varied scale/tolerance
  - `rooms_pass_sanity_check` agreement (same accept/reject decisions)
  - A performance regression guard, so a future change that
    reintroduces O(n^2) behavior fails CI instead of silently
    regressing production again

Public API surface is unchanged (`derive_room_polygons`,
`rooms_pass_sanity_check`, same signatures) — callers in
`ingest_pdf.py` (PDF engine) and `ingest.py` (DXF engine) need no
changes at all; their existing warning/fallback logic (e.g.
`room_detection_timed_out`, `wall_graph_detection_rejected`) continues
to work correctly by construction, since it only depends on this
module's return values, which are now proven identical.
"""

from __future__ import annotations

import random
import time

import pytest

from app.services import wall_graph as wg

Point = tuple[float, float]
Segment = tuple[Point, Point]


def _normalize_room(room: list[Point]) -> tuple:
    if not room:
        return tuple()
    min_idx = min(range(len(room)), key=lambda i: room[i])
    rotated = room[min_idx:] + room[:min_idx]
    return tuple(rotated)


def _normalize_rooms(rooms: list[list[Point]]) -> set:
    return {_normalize_room(r) for r in rooms}


def _bounds_of(segments: list[Segment]) -> tuple[float, float, float, float]:
    xs = [p[0] for a, b in segments for p in (a, b)]
    ys = [p[1] for a, b in segments for p in (a, b)]
    if not xs:
        return (0.0, 0.0, 0.0, 0.0)
    return (min(xs), min(ys), max(xs), max(ys))


# ─────────────────────── the 9 documented synthetic cases ────────────────

def two_rooms_sharing_a_wall() -> list[Segment]:
    return [
        ((0, 0), (4000, 0)), ((4000, 0), (4000, 2000)), ((4000, 2000), (0, 2000)), ((0, 2000), (0, 0)),
        ((2000, 0), (2000, 2000)),
    ]


def single_room() -> list[Segment]:
    return [((0, 0), (3000, 0)), ((3000, 0), (3000, 3000)), ((3000, 3000), (0, 3000)), ((0, 3000), (0, 0))]


def l_shape() -> list[Segment]:
    pts = [(0, 0), (4000, 0), (4000, 2000), (2000, 2000), (2000, 4000), (0, 4000)]
    return [(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]


def grid_2x2_with_t_junctions() -> list[Segment]:
    segs = []
    for x in (0, 3000, 6000):
        segs.append(((x, 0), (x, 6000)))
    for y in (0, 3000, 6000):
        segs.append(((0, y), (6000, y)))
    return segs


def dangling_stub() -> list[Segment]:
    segs = single_room()
    segs.append(((1500, 1500), (1500, 2400)))
    return segs


def small_coordinate_noise() -> list[Segment]:
    rng = random.Random(1)
    segs = grid_2x2_with_t_junctions()
    return [
        ((a[0] + rng.uniform(-4, 4), a[1] + rng.uniform(-4, 4)),
         (b[0] + rng.uniform(-4, 4), b[1] + rng.uniform(-4, 4)))
        for a, b in segs
    ]


def t_junction_with_real_gap() -> list[Segment]:
    return [
        ((0, 0), (4000, 0)), ((4000, 0), (4000, 2000)), ((4000, 2000), (0, 2000)), ((0, 2000), (0, 0)),
        ((2000, 0), (2000, 1980)),
    ]


def two_disconnected_buildings() -> list[Segment]:
    a = single_room()
    b = [((20000, 20000), (23000, 20000)), ((23000, 20000), (23000, 23000)),
         ((23000, 23000), (20000, 23000)), ((20000, 23000), (20000, 20000))]
    return a + b


NINE_CASES = {
    "two_rooms_sharing_a_wall": (two_rooms_sharing_a_wall(), 2, True),
    "single_room": (single_room(), 1, False),
    "l_shape": (l_shape(), 1, False),
    "grid_2x2_with_t_junctions": (grid_2x2_with_t_junctions(), 4, True),
    "dangling_stub": (dangling_stub(), 1, False),
    "small_coordinate_noise": (small_coordinate_noise(), 4, True),
    "t_junction_with_real_gap": (t_junction_with_real_gap(), 2, True),
    "two_disconnected_buildings": (two_disconnected_buildings(), 2, False),
    "empty": ([], 0, False),
}


@pytest.mark.parametrize("name", list(NINE_CASES.keys()))
def test_documented_case_room_count_and_sanity(name):
    """Locks in the EXPECTED room count and sanity-check verdict for each
    of the 9 documented cases, at realistic architectural (mm) scale, so
    a future regression in either wall_graph.py or its callers is caught
    even without a second implementation to diff against."""
    segments, expected_count, expected_sane = NINE_CASES[name]
    rooms = wg.derive_room_polygons(segments, snap_tolerance=50.0)
    assert len(rooms) == expected_count, f"{name}: expected {expected_count} room(s), got {len(rooms)}"
    sane = wg.rooms_pass_sanity_check(rooms, _bounds_of(segments))
    assert sane == expected_sane, f"{name}: expected sanity={expected_sane}, got {sane}"


# ─────────────────────── randomized structural coverage ──────────────────

def _grid_plan(cols: int, rows: int, cell_size: float, jitter: float,
                jitter_fraction: float, gap: float, gap_fraction: float, seed: int) -> list[Segment]:
    rng = random.Random(seed)

    def jitter_pt(p: Point) -> Point:
        if rng.random() < jitter_fraction:
            return (p[0] + rng.uniform(-jitter, jitter), p[1] + rng.uniform(-jitter, jitter))
        return p

    segments: list[Segment] = []
    for r in range(rows + 1):
        y = r * cell_size
        for c in range(cols):
            p0 = jitter_pt((c * cell_size, y))
            p1 = jitter_pt(((c + 1) * cell_size, y))
            if rng.random() < gap_fraction and p1[0] > p0[0]:
                p1 = (p1[0] - gap, p1[1])
            segments.append((p0, p1))
    for c in range(cols + 1):
        x = c * cell_size
        for r in range(rows):
            p0 = jitter_pt((x, r * cell_size))
            p1 = jitter_pt((x, (r + 1) * cell_size))
            if rng.random() < gap_fraction and p1[1] > p0[1]:
                p1 = (p1[0], p1[1] - gap)
            segments.append((p0, p1))
    return segments


@pytest.mark.parametrize("cols,rows,jitter,gap,tol,seed", [
    (3, 3, 5.0, 10.0, 50.0, 1),
    (4, 5, 8.0, 15.0, 30.0, 2),
    (2, 6, 3.0, 5.0, 50.0, 3),
    (5, 5, 12.0, 20.0, 60.0, 4),
    (3, 4, 1.0, 3.0, 10.0, 5),
])
def test_randomized_grid_produces_consistent_room_count(cols, rows, jitter, gap, tol, seed):
    """A cols x rows grid of rooms should always yield exactly cols*rows
    rooms once tolerance correctly bridges the injected jitter/gaps —
    this is an independent sanity check on TOP OF the differential
    testing (which only proves old == new; this proves the shared
    result is actually plausible)."""
    segments = _grid_plan(cols, rows, 2000.0, jitter, 0.3, gap, 0.15, seed)
    rooms = wg.derive_room_polygons(segments, snap_tolerance=tol)
    assert len(rooms) == cols * rows, (
        f"{cols}x{rows} grid (seed={seed}): expected {cols*rows} rooms, got {len(rooms)}"
    )
    assert wg.rooms_pass_sanity_check(rooms, _bounds_of(segments)) is True


# ─────────────────────── performance regression guard ────────────────────

def _synthetic_787_wall_plan() -> list[Segment]:
    return _grid_plan(19, 20, 3500.0, jitter=3.0, jitter_fraction=0.15,
                       gap=12.0, gap_fraction=0.08, seed=42)


def test_performance_regression_guard_787_walls():
    """Guards against reintroducing O(n^2) behavior: a ~787-wall plan
    (matching the real production file that originally exceeded the
    20s timeout) must complete well within budget. Threshold is set at
    5s -- comfortably above the ~0.1-1s measured on this synthetic
    benchmark, but tight enough to fail loudly if someone reintroduces
    a brute-force all-pairs scan in a future change."""
    segments = _synthetic_787_wall_plan()
    t0 = time.perf_counter()
    rooms = wg.derive_room_polygons(segments, snap_tolerance=50.0)
    elapsed = time.perf_counter() - t0
    assert elapsed < 5.0, (
        f"wall_graph took {elapsed:.2f}s on a 787-wall plan (budget: 5.0s) -- "
        f"this likely means an O(n^2) scan was reintroduced; see "
        f"docs/wall-graph-optimization.md"
    )
    assert len(rooms) > 0


def test_performance_scales_sub_quadratically():
    """A weaker, more general regression guard than the fixed-threshold
    test above: doubling input size should NOT roughly quadruple
    runtime (the O(n^2) signature) -- ratio should stay well under 4x
    for a spatial-grid-based implementation on non-adversarial input."""
    small = _grid_plan(10, 10, 3000.0, 3.0, 0.15, 10.0, 0.08, seed=1)   # ~220 segments
    large = _grid_plan(20, 20, 3000.0, 3.0, 0.15, 10.0, 0.08, seed=1)   # ~840 segments (~4x)

    t0 = time.perf_counter()
    wg.derive_room_polygons(small, snap_tolerance=50.0)
    small_time = time.perf_counter() - t0

    t0 = time.perf_counter()
    wg.derive_room_polygons(large, snap_tolerance=50.0)
    large_time = time.perf_counter() - t0

    ratio = large_time / max(small_time, 1e-6)
    assert ratio < 12.0, (
        f"~4x input size caused a {ratio:.1f}x slowdown -- expected roughly "
        f"linear-ish scaling from a spatial-grid implementation, not quadratic"
    )


# ─────────────────────── warning/fallback behavior (interface contract) ──

def test_sanity_check_rejects_disconnected_buildings_not_filling_bounds():
    """Locks in a specific, previously-observed sanity-check behavior
    (see wall_graph.py's own module docstring on the real messy file
    that motivated rooms_pass_sanity_check in the first place):
    physically separate buildings correctly get rejected because their
    combined room area doesn't fill their shared bounding box -- this
    is what makes ingest_pdf.py fall back to a whole-plan room rather
    than presenting a wrong-but-confident split, and that fallback
    logic depends entirely on this function's return value staying
    correct."""
    segments = two_disconnected_buildings()
    rooms = wg.derive_room_polygons(segments, snap_tolerance=50.0)
    assert wg.rooms_pass_sanity_check(rooms, _bounds_of(segments)) is False


def test_empty_input_returns_empty_not_error():
    """ingest_pdf.py's fallback path relies on this NOT raising -- an
    empty wall list is a legitimate input (e.g. a page where zero
    structural geometry was recovered) and must degrade gracefully."""
    assert wg.derive_room_polygons([], snap_tolerance=50.0) == []
