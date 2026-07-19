"""
app/services/wall_graph.py

Derives closed room polygons directly from wall centerline geometry —
the "faces" of the planar graph the walls form — via segment
intersection splitting, endpoint/gap snapping, and half-edge face
tracing. Pure stdlib (no shapely, still not installable anywhere this
has been built/tested).

This is the fallback room-detection path used when a DXF has real wall
geometry but no explicit room-boundary polylines (see
app/services/ingest.py) — the common case for real architectural firms,
who usually don't draw dedicated room-boundary polylines at all.

Validated against 9 synthetic cases (two rooms sharing a wall, a single
room, an L-shape, a 2x2 grid with T-junctions, a dangling stub, small
coordinate noise, a T-junction with a real gap, and two disconnected
buildings) and against one real, messy production-style file. That real
file exposed the actual hard limit of this approach: some drawings have
connectivity gaps at multiple, mutually-incompatible scales, so no
single global snap tolerance can cleanly resolve them.
`rooms_pass_sanity_check()` exists specifically to catch that failure
mode and refuse to present a wrong-but-confident room split — see its
docstring.

PERFORMANCE NOTE (see docs/wall-graph-optimization.md for the full
profiling report and design rationale): the three steps that compare
points/segments against "everything else" (`_snap_points`,
`_close_t_junction_gaps`, `_split_segments_at_intersections`) are
implemented via a uniform spatial grid rather than brute-force
all-pairs scanning. A query only checks the grid cell it falls in plus
its 8 neighbors — since nothing farther than one cell away can be
within `tolerance` when the cell size equals `tolerance`, this changes
each of those three steps from O(n^2) to close to O(n) on realistic,
non-adversarial inputs, while producing IDENTICAL output to the
original brute-force implementation (validated by direct comparison
against the pre-optimization version on 9 synthetic correctness cases
plus randomized differential tests — see tests/test_wall_graph_bench.py
and tests/test_wall_graph_regression.py). The public API and every
function signature are unchanged; this is a pure performance rewrite.
"""

from __future__ import annotations

import math
from collections import defaultdict

Point = tuple[float, float]
Segment = tuple[Point, Point]


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


# ── Spatial grid helper (shared by all three optimized steps) ──────────────

class _SpatialGrid:
    """Buckets 2D points into cells of size `cell_size`, so "find
    everything within `tolerance` of this point" only has to check the
    point's own cell and its 8 neighbors, instead of every stored item.

    This is correct as long as `cell_size >= tolerance`: two points
    farther apart than one cell width can never be within `tolerance`
    of each other, so nothing outside the 3x3 neighborhood needs to be
    considered. Ties are broken the same way brute-force nearest-search
    would (exact distance comparison on the reduced candidate set), so
    results are identical to brute force, just cheaper to compute.
    """

    __slots__ = ("cell_size", "buckets")

    def __init__(self, cell_size: float):
        self.cell_size = max(cell_size, 1e-6)
        self.buckets: dict[tuple[int, int], list] = defaultdict(list)

    def _cell(self, pt: Point) -> tuple[int, int]:
        return (int(math.floor(pt[0] / self.cell_size)),
                int(math.floor(pt[1] / self.cell_size)))

    def insert(self, pt: Point, item) -> None:
        self.buckets[self._cell(pt)].append((pt, item))

    def nearby(self, pt: Point):
        """Yields (point, item) for every entry in the query point's
        cell and its 8 neighbors."""
        cx, cy = self._cell(pt)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                bucket = self.buckets.get((cx + dx, cy + dy))
                if bucket:
                    yield from bucket


# ── Step 1: segment-segment intersection ────────────────────────────────

def _segment_intersection(p1: Point, p2: Point, p3: Point, p4: Point) -> Point | None:
    """Returns the intersection point of segments (p1,p2) and (p3,p4) if
    they cross at a single interior point, else None. Deliberately
    ignores collinear-overlap cases (returns None) — those don't need a
    graph vertex inserted, the segments already share that geometry."""
    x1, y1 = p1; x2, y2 = p2; x3, y3 = p3; x4, y4 = p4
    d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
    if abs(d) < 1e-9:
        return None  # parallel or collinear
    t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
    u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
    eps = 1e-6
    if -eps <= t <= 1 + eps and -eps <= u <= 1 + eps:
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    return None


def _segment_bbox(a: Point, b: Point) -> tuple[float, float, float, float]:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))


def _bbox_cells(bbox: tuple[float, float, float, float], cell_size: float):
    """Every grid cell a segment's bounding box overlaps."""
    x0, y0, x1, y1 = bbox
    cx0, cy0 = int(math.floor(x0 / cell_size)), int(math.floor(y0 / cell_size))
    cx1, cy1 = int(math.floor(x1 / cell_size)), int(math.floor(y1 / cell_size))
    for cx in range(cx0, cx1 + 1):
        for cy in range(cy0, cy1 + 1):
            yield (cx, cy)


def _split_segments_at_intersections(segments: list[Segment]) -> list[Segment]:
    """For every pair of segments that cross at an interior point, insert
    that point as a shared vertex by splitting both segments there.

    Only pairs whose bounding boxes fall in the same or an adjacent grid
    cell are ever tested (a segment can only intersect another segment
    that its bounding box could plausibly reach) — this replaces the
    original's documented O(n^2) all-pairs scan with a candidate set
    that stays small on realistic (non-degenerately-overlapping) plans,
    while testing the exact same geometric predicate per candidate pair,
    so results are identical to brute force.
    """
    if not segments:
        return []

    # Cell size: the median segment length keeps the grid fine enough to
    # avoid huge buckets on a long outer wall, coarse enough to avoid
    # excessive cell counts for many short segments.
    lengths = sorted(_dist(a, b) for a, b in segments if _dist(a, b) > 1e-9)
    cell_size = lengths[len(lengths) // 2] if lengths else 1000.0
    cell_size = max(cell_size, 1.0)

    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    bboxes = [_segment_bbox(a, b) for a, b in segments]
    for i, bbox in enumerate(bboxes):
        for cell in _bbox_cells(bbox, cell_size):
            grid[cell].append(i)

    split_points: list[list[Point]] = [[] for _ in segments]
    tested: set[tuple[int, int]] = set()

    for i in range(len(segments)):
        a1, a2 = segments[i]
        candidates: set[int] = set()
        for cell in _bbox_cells(bboxes[i], cell_size):
            candidates.update(grid.get(cell, ()))
        for j in candidates:
            if j <= i:
                continue
            key = (i, j)
            if key in tested:
                continue
            tested.add(key)
            b1, b2 = segments[j]
            pt = _segment_intersection(a1, a2, b1, b2)
            if pt is None:
                continue
            if _dist(pt, a1) > 1e-3 and _dist(pt, a2) > 1e-3:
                split_points[i].append(pt)
            if _dist(pt, b1) > 1e-3 and _dist(pt, b2) > 1e-3:
                split_points[j].append(pt)

    result: list[Segment] = []
    for (a, b), extra in zip(segments, split_points):
        if not extra:
            result.append((a, b))
            continue

        def param(pt: Point, a=a, b=b) -> float:
            dx, dy = b[0] - a[0], b[1] - a[1]
            length_sq = dx * dx + dy * dy
            if length_sq < 1e-12:
                return 0.0
            return ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / length_sq

        ordered = sorted(set(extra), key=param)
        chain = [a] + ordered + [b]
        for k in range(len(chain) - 1):
            if _dist(chain[k], chain[k + 1]) > 1e-6:
                result.append((chain[k], chain[k + 1]))
    return result


# ── Step 2: endpoint snapping ────────────────────────────────────────────

def _snap_points(segments: list[Segment], tolerance: float) -> list[Segment]:
    """Clusters near-coincident endpoints (within `tolerance`) into one
    shared point, using greedy nearest-cluster assignment. Real
    architectural drawings frequently have corners that are meant to
    coincide but are off by a few mm/cm due to manual drafting.

    Cluster lookup uses a spatial grid (cell size = tolerance) instead
    of a linear scan over every existing cluster: a point can only join
    a cluster whose representative center is within `tolerance`, and
    with cell size == tolerance, any such cluster's most recent point
    must be registered in the query point's cell or one of its 8
    neighbors. Clusters are re-registered under their (possibly moved)
    centroid's cell each time a point is added, so lookups always find
    live clusters regardless of how far a centroid has drifted from
    where it started. Greedy assignment order and tie-breaking (first
    cluster found within tolerance, iterating in the original brute
    force's implicit order) are preserved so output is identical.
    """
    if not segments:
        return []

    grid = _SpatialGrid(cell_size=tolerance)
    clusters: list[list[Point]] = []
    cluster_of: dict[Point, int] = {}
    cluster_centroid: list[Point] = []

    def find_or_create_cluster(pt: Point) -> int:
        best_idx = None
        best_dist = tolerance
        seen: set[int] = set()
        for _, idx in grid.nearby(pt):
            if idx in seen:
                continue
            seen.add(idx)
            d = _dist(pt, cluster_centroid[idx])
            # Preserve brute force's behavior exactly: it returns the
            # FIRST cluster (in insertion order) whose centroid is
            # within tolerance, not the nearest one. Replicate that by
            # scanning candidates in ascending cluster-index order.
            if d <= tolerance and (best_idx is None or idx < best_idx):
                best_idx = idx
                best_dist = d
        if best_idx is not None:
            cluster = clusters[best_idx]
            cluster.append(pt)
            cx = sum(p[0] for p in cluster) / len(cluster)
            cy = sum(p[1] for p in cluster) / len(cluster)
            cluster_centroid[best_idx] = (cx, cy)
            grid.insert((cx, cy), best_idx)
            return best_idx
        idx = len(clusters)
        clusters.append([pt])
        cluster_centroid.append(pt)
        grid.insert(pt, idx)
        return idx

    all_points = []
    for a, b in segments:
        all_points.append(a)
        all_points.append(b)

    for pt in all_points:
        idx = find_or_create_cluster(pt)
        cluster_of[pt] = idx

    def representative(idx: int) -> Point:
        cluster = clusters[idx]
        cx = sum(p[0] for p in cluster) / len(cluster)
        cy = sum(p[1] for p in cluster) / len(cluster)
        return (round(cx, 3), round(cy, 3))

    reps = [representative(i) for i in range(len(clusters))]

    snapped: list[Segment] = []
    for a, b in segments:
        ra = reps[cluster_of[a]]
        rb = reps[cluster_of[b]]
        if _dist(ra, rb) > 1e-6:
            snapped.append((ra, rb))
    return snapped


# ── Step 3: build the planar graph ──────────────────────────────────────

def _dedupe_segments(segments: list[Segment]) -> list[Segment]:
    seen = set()
    out = []
    for a, b in segments:
        key = tuple(sorted([a, b]))
        if key not in seen:
            seen.add(key)
            out.append((a, b))
    return out


class PlanarGraph:
    def __init__(self, segments: list[Segment]):
        self.adj: dict[Point, list[Point]] = defaultdict(list)
        for a, b in segments:
            self.adj[a].append(b)
            self.adj[b].append(a)
        # Sort each vertex's neighbors by angle for consistent face tracing.
        for v in self.adj:
            self.adj[v].sort(key=lambda w: math.atan2(w[1] - v[1], w[0] - v[0]))


# ── Step 4: half-edge face tracing ──────────────────────────────────────

def _trace_faces(graph: PlanarGraph) -> list[list[Point]]:
    """
    Traces every face of the planar graph via the standard "next edge in
    clockwise order after the reverse of the incoming edge" rule — the
    same principle used by DCEL-based polygon extraction (and by
    shapely.ops.polygonize under the hood, via GEOS).

    Returns a list of faces, each a list of points forming a closed loop
    (first point not repeated at the end). Includes the outer/unbounded
    face — callers must exclude it (see `derive_room_polygons`).
    """
    visited: set[tuple[Point, Point]] = set()
    faces: list[list[Point]] = []

    for start_u in graph.adj:
        for start_v in graph.adj[start_u]:
            if (start_u, start_v) in visited:
                continue

            face: list[Point] = [start_u]
            u, v = start_u, start_v
            visited.add((u, v))
            guard = 0
            while True:
                face.append(v)
                guard += 1
                if guard > 10000:
                    break  # safety valve against a graph-construction bug looping forever
                neighbors = graph.adj[v]
                # Find index of u (where we came from) in v's sorted neighbor list.
                idx = neighbors.index(u)
                # Next edge, going clockwise: the one immediately BEFORE
                # the reverse-incoming edge in the angle-sorted list.
                nxt = neighbors[(idx - 1) % len(neighbors)]
                edge = (v, nxt)
                if edge in visited:
                    break
                visited.add(edge)
                u, v = v, nxt
                if v == start_u and u == start_v:
                    break
                if u == start_u and v == start_v:
                    break

            if len(face) >= 3:
                if face[0] == face[-1]:
                    face = face[:-1]
                faces.append(face)

    return faces


def _polygon_area_signed(points: list[Point]) -> float:
    area = 0.0
    n = len(points)
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        area += x0 * y1 - x1 * y0
    return area / 2.0


def _connected_components(graph: PlanarGraph) -> list[set[Point]]:
    """Splits the graph into connected components via BFS. Needed because
    real drawings often have disconnected wall clusters (a detached
    garage, separate outbuildings) — each has its OWN outer/unbounded
    face, so "exclude the single largest face" must be done per
    component, not globally."""
    visited: set[Point] = set()
    components: list[set[Point]] = []
    for start in graph.adj:
        if start in visited:
            continue
        component: set[Point] = set()
        queue = [start]
        while queue:
            node = queue.pop()
            if node in component:
                continue
            component.add(node)
            visited.add(node)
            for neighbor in graph.adj[node]:
                if neighbor not in component:
                    queue.append(neighbor)
        components.append(component)
    return components


def _closest_point_on_segment(pt: Point, a: Point, b: Point) -> tuple[Point, float]:
    """Returns (closest_point, distance) from pt to segment a-b."""
    ax, ay = a; bx, by = b; px, py = pt
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq < 1e-12:
        return a, _dist(pt, a)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    closest = (ax + t * dx, ay + t * dy)
    return closest, _dist(pt, closest)


def _close_t_junction_gaps(segments: list[Segment], tolerance: float) -> list[Segment]:
    """
    Real-world walls frequently T-junction into the MIDDLE of another
    wall with a small gap (a few mm/cm) rather than exactly touching —
    something segment-crossing detection and endpoint-to-endpoint
    snapping both miss, since neither the "crossing" test nor the
    "nearby endpoint" test fires when a gap exists to a segment's
    interior rather than its endpoint. This closes that gap: for every
    endpoint not already coincident with another endpoint, find the
    nearest point on any OTHER nearby segment; if within tolerance,
    split that segment there and snap this endpoint onto it.

    Both the "already coincident?" check and the "nearest segment"
    search use a spatial grid instead of scanning every point/segment —
    this is the single biggest cost in the original implementation
    (see docs/wall-graph-optimization.md), since it ran an O(segments)
    scan for EVERY endpoint. Segments are indexed by every grid cell
    their bounding box touches (same approach as
    `_split_segments_at_intersections`), so a query only tests segments
    that could plausibly be within `tolerance` of the query point.
    """
    points = []
    for a, b in segments:
        points.append(a)
        points.append(b)

    if not points:
        return []

    # "Already coincident with another endpoint" check, via grid instead
    # of an O(P) scan per point. Cell size 1.0 matches the original's
    # fixed 1.0-unit coincidence threshold exactly.
    coincidence_grid = _SpatialGrid(cell_size=1.0)
    for pt in points:
        coincidence_grid.insert(pt, pt)

    def has_coincident_other(pt: Point) -> bool:
        for other_pt, _ in coincidence_grid.nearby(pt):
            if other_pt != pt and _dist(other_pt, pt) < 1.0:
                return True
        return False

    # Segment index for the nearest-segment search, bucketed by every
    # cell each segment's bounding box overlaps (cell size = tolerance,
    # so nothing farther than one cell away can be within tolerance).
    seg_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    bboxes = [_segment_bbox(a, b) for a, b in segments]
    for i, bbox in enumerate(bboxes):
        for cell in _bbox_cells(bbox, max(tolerance, 1.0)):
            seg_grid[cell].append(i)

    def segment_candidates(pt: Point):
        cx = int(math.floor(pt[0] / max(tolerance, 1.0)))
        cy = int(math.floor(pt[1] / max(tolerance, 1.0)))
        seen: set[int] = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for idx in seg_grid.get((cx + dx, cy + dy), ()):
                    if idx not in seen:
                        seen.add(idx)
                        yield idx

    extra_splits: dict[int, list[Point]] = {i: [] for i in range(len(segments))}
    snapped_endpoint: dict[Point, Point] = {}

    for pt in points:
        if has_coincident_other(pt):
            continue
        best_seg_idx = None
        best_point = None
        best_dist = tolerance
        for i in sorted(segment_candidates(pt)):
            a, b = segments[i]
            if _dist(pt, a) < 1.0 or _dist(pt, b) < 1.0:
                continue  # pt IS this segment's own endpoint
            closest, d = _closest_point_on_segment(pt, a, b)
            # Preserve brute force's exact tie-break: strict "<" means the
            # first segment (lowest index) to achieve the minimum distance
            # wins; scanning candidates in ascending index order (not grid
            # bucket order) replicates that exactly.
            if d < best_dist:
                best_dist = d
                best_seg_idx = i
                best_point = closest
        if best_seg_idx is not None:
            extra_splits[best_seg_idx].append(best_point)
            snapped_endpoint[pt] = best_point

    result: list[Segment] = []
    for i, (a, b) in enumerate(segments):
        extra = extra_splits[i]
        a2 = snapped_endpoint.get(a, a)
        b2 = snapped_endpoint.get(b, b)
        if not extra:
            if _dist(a2, b2) > 1e-6:
                result.append((a2, b2))
            continue

        def param(pt: Point, a2=a2, b2=b2) -> float:
            dx, dy = b2[0] - a2[0], b2[1] - a2[1]
            length_sq = dx * dx + dy * dy
            if length_sq < 1e-12:
                return 0.0
            return ((pt[0] - a2[0]) * dx + (pt[1] - a2[1]) * dy) / length_sq

        ordered = sorted(set(extra), key=param)
        chain = [a2] + ordered + [b2]
        for k in range(len(chain) - 1):
            if _dist(chain[k], chain[k + 1]) > 1e-6:
                result.append((chain[k], chain[k + 1]))
    return result


def derive_room_polygons(wall_segments: list[Segment], snap_tolerance: float = 50.0) -> list[list[Point]]:
    """
    Public entry point: given raw wall centerline segments, returns the
    interior room polygons. The outer/unbounded envelope face is
    excluded PER CONNECTED COMPONENT (a file with a detached garage or
    separate outbuilding has more than one "outer face" — each is
    identified as the largest-area face within its own component, not
    globally across the whole drawing).
    """
    if not wall_segments:
        return []

    split = _split_segments_at_intersections(wall_segments)
    snapped = _snap_points(split, snap_tolerance)
    gap_closed = _close_t_junction_gaps(snapped, snap_tolerance)
    # Closing gaps can itself create new crossings/T-junctions, so run
    # one more pass of each — cheap at this scale, converges quickly
    # since each pass only affects points that were dangling.
    re_split = _split_segments_at_intersections(gap_closed)
    re_snapped = _snap_points(re_split, snap_tolerance)
    deduped = _dedupe_segments(re_snapped)
    if len(deduped) < 3:
        return []

    graph = PlanarGraph(deduped)
    faces = _trace_faces(graph)
    if not faces:
        return []

    components = _connected_components(graph)

    rooms: list[list[Point]] = []
    for component in components:
        # Faces whose points all belong to this component.
        component_faces = [f for f in faces if set(f) <= component]
        if len(component_faces) <= 1:
            continue  # a component with only one traced face has no bounded interior
        areas = [abs(_polygon_area_signed(f)) for f in component_faces]
        outer_idx = areas.index(max(areas))
        rooms.extend(f for i, f in enumerate(component_faces) if i != outer_idx)

    return rooms


def rooms_pass_sanity_check(rooms: list[list[Point]], overall_bounds: tuple[float, float, float, float]) -> bool:
    """
    Decides whether wall-graph-derived rooms are trustworthy enough to
    show, or whether the wall network was too fragmented/inconsistent
    for this file (see the "no single tolerance works" finding — some
    real drawings have gaps at multiple, incompatible scales that no
    global snap tolerance can cleanly resolve). Never present a
    plausible-looking-but-wrong room split — the whole-plan fallback,
    while less useful, is honest about what wasn't detected.

    Rejects the result if:
      - fewer than 2 rooms were found (nothing gained over the fallback), or
      - any single room is disproportionately larger than the rest
        combined (a strong signal the graph is still under-connected:
        several real rooms got merged into one blob because a partition
        wall's gap wasn't closed), or
      - the rooms' total area is an implausibly small fraction of the
        drawing's overall bounding box (most of the building is
        "missing" from the detected rooms).
    """
    if len(rooms) < 2:
        return False

    areas = [abs(_polygon_area_signed(r)) for r in rooms]
    total = sum(areas)
    largest = max(areas)
    rest = total - largest

    # A single room shouldn't dwarf the combined area of every other
    # detected room — that pattern is exactly what an under-connected
    # graph produces (see the real-file investigation this was built
    # against: a 755,000-area outlier next to a 12,000 combined rest).
    if rest > 0 and largest / rest > 4.0:
        return False
    if rest == 0 and len(areas) > 1:
        return False

    min_x, min_y, max_x, max_y = overall_bounds
    bounds_area = (max_x - min_x) * (max_y - min_y)
    if bounds_area > 0 and (total / bounds_area) < 0.5:
        return False

    return True
