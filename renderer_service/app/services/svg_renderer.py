"""
app/services/svg_renderer.py

Composites the IR into a single master SVG string, in a fixed z-order:
room floor fills -> walls -> openings -> furniture (+ shadows) -> room
labels. SVG is always the master artifact — this module produces only
SVG text; rasterization (to PNG/PDF) is intentionally out of scope here
and happens on the Next.js side (or a future /export endpoint).

Ported from cad_service/svg_renderer.py; centroid math now comes from
app/utils/geometry.py instead of a private duplicated function.
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from app.models.floorplan import FloorPlanIR, Room, FurnitureItem, Opening, OpeningKind, Wall
from app.services.theme import Theme
from app.services.assets import symbol_for
from app.utils.geometry import polygon_centroid

MARGIN_MM = 400.0


def _points_attr(points: list[tuple[float, float]]) -> str:
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in points)


def _render_room(room: Room, theme: Theme) -> str:
    colors = theme.room_colors.get(room.room_type, list(theme.room_colors.values())[-1])
    pts = [(p.x, p.y) for p in room.boundary.points]
    return f'<polygon points="{_points_attr(pts)}" fill="{colors.floor}" stroke="none" />'


def _render_room_label(room: Room, theme: Theme) -> str:
    pts = [(p.x, p.y) for p in room.boundary.points]
    cx, cy = polygon_centroid(pts)
    name = room.label_text or room.room_type.value.replace("_", " ").title()
    area_txt = f"{room.area_sqm:.1f} m²" if room.area_sqm else ""
    return f'''
        <g font-family="Helvetica, Arial, sans-serif" text-anchor="middle">
            <text x="{cx:.1f}" y="{cy:.1f}" font-size="220" font-weight="600"
                  fill="{theme.room_label_color}">{escape(name)}</text>
            <text x="{cx:.1f}" y="{cy + 260:.1f}" font-size="160"
                  fill="{theme.room_label_color}" opacity="0.65">{escape(area_txt)}</text>
        </g>
    '''


def _render_wall(wall: Wall, theme: Theme) -> str:
    pts = [(p.x, p.y) for p in wall.centerline.points]
    if len(pts) < 2:
        return ""
    stroke_w = max(wall.thickness_mm, theme.wall_stroke_mm)
    poly = " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts)
    return (f'<path d="M {poly}" fill="none" stroke="{theme.wall_stroke_color}" '
            f'stroke-width="{stroke_w:.1f}" stroke-linecap="square" stroke-linejoin="miter" />')


def _render_opening(opening: Opening, theme: Theme) -> str:
    x, y = opening.position.x, opening.position.y
    w = opening.width_mm
    rot = opening.rotation_deg
    if opening.kind == OpeningKind.WINDOW:
        inner = (
            f'<line x1="{-w/2:.1f}" y1="0" x2="{w/2:.1f}" y2="0" '
            f'stroke="{theme.wall_stroke_color}" stroke-width="14" />'
            f'<line x1="{-w/2:.1f}" y1="-40" x2="{w/2:.1f}" y2="-40" '
            f'stroke="{theme.wall_stroke_color}" stroke-width="10" opacity="0.7" />'
            f'<line x1="{-w/2:.1f}" y1="40" x2="{w/2:.1f}" y2="40" '
            f'stroke="{theme.wall_stroke_color}" stroke-width="10" opacity="0.7" />'
        )
    else:
        inner = (
            f'<line x1="0" y1="0" x2="0" y2="{w:.1f}" '
            f'stroke="{theme.furniture_stroke_color}" stroke-width="14" />'
            f'<path d="M 0 0 A {w:.1f} {w:.1f} 0 0 1 {w:.1f} 0" '
            f'fill="none" stroke="{theme.furniture_stroke_color}" stroke-width="6" '
            f'stroke-dasharray="18 12" opacity="0.6" />'
        )
    return f'<g transform="translate({x:.1f},{y:.1f}) rotate({rot:.1f})">{inner}</g>'


def _render_furniture(item: FurnitureItem, theme: Theme) -> str:
    fw, fd = item.footprint_mm
    sx = (fw / 1000.0) * item.scale_x
    sy = (fd / 1000.0) * item.scale_y
    symbol = symbol_for(item.category)
    shadow = ""
    if theme.shadow_enabled:
        shadow = (
            f'<g transform="translate(30,40) scale({sx:.4f},{sy:.4f})" '
            f'opacity="{theme.shadow_opacity}" filter="url(#furnitureShadow)">{symbol}</g>'
        )
    return (
        f'<g transform="translate({item.insertion_point.x:.1f},{item.insertion_point.y:.1f}) '
        f'rotate({item.rotation_deg:.1f})">'
        f'{shadow}'
        f'<g transform="scale({sx:.4f},{sy:.4f})">{symbol}</g>'
        f'</g>'
    )


def render_svg(ir: FloorPlanIR, theme: Theme) -> str:
    min_x, min_y, max_x, max_y = ir.bounds()
    min_x -= MARGIN_MM
    min_y -= MARGIN_MM
    width = (max_x - min_x) + MARGIN_MM
    height = (max_y - min_y) + MARGIN_MM

    rooms_svg = "\n".join(_render_room(r, theme) for r in ir.rooms)
    walls_svg = "\n".join(_render_wall(w, theme) for w in ir.walls)
    openings_svg = "\n".join(_render_opening(o, theme) for o in ir.openings)
    furniture_svg = "\n".join(_render_furniture(f, theme) for f in ir.furniture)
    labels_svg = "\n".join(_render_room_label(r, theme) for r in ir.rooms)

    css_vars = (
        f"--furniture-stroke: {theme.furniture_stroke_color}; "
        f"--furniture-fill: {theme.furniture_fill_color}; "
        f"--furniture-fill-secondary: {theme.furniture_fill_secondary}; "
        f"--furniture-accent: {theme.furniture_accent_color};"
    )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min_x:.1f} {min_y:.1f} {width:.1f} {height:.1f}"
     width="{width:.0f}mm" height="{height:.0f}mm" style="{css_vars}">
  <!-- width/height carry an explicit "mm" unit so this is a properly
       physically-sized vector document, not an implicit pixel count —
       a bare number here gets read as literal pixels by rasterizers,
       which for a real building-sized plan (tens of thousands of mm)
       produces an absurd, often over-limit pixel count. The viewBox
       below remains the source of truth for the internal mm coordinate
       system either way; rasterization resolution is controlled
       explicitly by the caller (see lib/cadSvgRaster.ts), not implied
       by this attribute. -->
  <defs>
    <filter id="furnitureShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="25" />
    </filter>
  </defs>
  <rect x="{min_x:.1f}" y="{min_y:.1f}" width="{width:.1f}" height="{height:.1f}" fill="#FAFBFD" />
  <g id="rooms">{rooms_svg}</g>
  <g id="walls">{walls_svg}</g>
  <g id="openings">{openings_svg}</g>
  <g id="furniture">{furniture_svg}</g>
  <g id="labels">{labels_svg}</g>
</svg>'''
