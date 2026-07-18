"""
app/utils/geometry.py

Pure, dependency-free 2D geometry helpers used by the rendering
pipeline. Extracted during the Sprint 2 port — these lived as private
functions duplicated across `cad_service/ingest.py` and
`cad_service/svg_renderer.py`; pulling them into one shared, tested
module is a genuine clean-architecture improvement, not new behavior.
"""

from __future__ import annotations


def shoelace_area_sqm(points_mm: list[tuple[float, float]]) -> float:
    """Polygon area via the shoelace formula. Input points in millimetres;
    returns square metres. Fewer than 3 points -> 0.0."""
    if len(points_mm) < 3:
        return 0.0
    area = 0.0
    n = len(points_mm)
    for i in range(n):
        x0, y0 = points_mm[i]
        x1, y1 = points_mm[(i + 1) % n]
        area += x0 * y1 - x1 * y0
    return abs(area) / 2.0 / 1_000_000.0  # mm^2 -> m^2


def polygon_centroid(points: list[tuple[float, float]]) -> tuple[float, float]:
    """Shoelace-formula centroid. Falls back to the arithmetic mean for
    degenerate (near-zero-area, or <3-point) polygons."""
    if len(points) < 3:
        if not points:
            return (0.0, 0.0)
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return (sum(xs) / len(xs), sum(ys) / len(ys))

    area = 0.0
    cx = 0.0
    cy = 0.0
    n = len(points)
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    area *= 0.5
    if abs(area) < 1e-6:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return (sum(xs) / len(xs), sum(ys) / len(ys))
    cx /= (6 * area)
    cy /= (6 * area)
    return (cx, cy)


def point_in_polygon(point: tuple[float, float], polygon_points: list[tuple[float, float]]) -> bool:
    """Standard ray-casting point-in-polygon test."""
    x, y = point
    inside = False
    n = len(polygon_points)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = polygon_points[i]
        xj, yj = polygon_points[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside
