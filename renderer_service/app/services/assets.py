"""
app/services/assets.py

The Asset Library. The renderer never draws furniture procedurally
per-instance from raw CAD geometry — it places one of these pre-authored
symbols, exactly at the transform recorded in the IR (insertion point,
rotation, scale). Each symbol is normalized to a 1000x1000 design box
centered at the origin (-500..500 on each axis), top-down/plan view.

Sprint 4: replaces the Sprint 1/2-era placeholder symbols (plain
rectangles with a couple of accent lines) with genuinely detailed,
presentation-quality plan-view illustrations — pillows and a folded
throw on beds, cushion divisions and rolled arms on seating, cabinet/
door panel lines on casework, fixture details on plumbing. Geometry
placement is untouched by this change: every symbol still fits its
category's existing normalized box, so app/services/svg_renderer.py's
placement transform (translate -> rotate -> scale by footprint_mm) needs
no changes at all — only what's drawn *inside* that box changed.

Colors are CSS custom properties, set per-theme in svg_renderer.py:
  --furniture-stroke            outlines
  --furniture-fill              primary body fill
  --furniture-fill-secondary    pillows / cushions / secondary surfaces
  --furniture-accent            seam lines, panel lines, fixture details
"""

from __future__ import annotations

from app.models.floorplan import FurnitureCategory

_STROKE = "var(--furniture-stroke)"
_FILL = "var(--furniture-fill)"
_FILL_2 = "var(--furniture-fill-secondary)"
_ACCENT = "var(--furniture-accent)"


# ── Parametrized families (reduces duplication, keeps quality consistent) ──

def _bed_symbol(half_width: float, length_top: float = -480.0, length_bottom: float = 480.0,
                 pillow_count: int = 2) -> str:
    """A bed: frame, a headboard band, pillows, and a folded-throw accent
    line at the foot — reads clearly as "bed" at a glance, at any of the
    three bed sizes (single/queen/king), which only differ in half_width."""
    hw = half_width
    headboard_bottom = length_top + 90
    pillow_w = (hw * 2 - 60) / pillow_count - 20
    pillows = []
    x = -hw + 40
    for _ in range(pillow_count):
        pillows.append(
            f'<rect x="{x:.0f}" y="{length_top + 15:.0f}" width="{pillow_w:.0f}" height="200" '
            f'rx="24" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="5"/>'
        )
        x += pillow_w + 20
    pillows_svg = "".join(pillows)
    return f'''
        <rect x="{-hw:.0f}" y="{length_top:.0f}" width="{hw*2:.0f}" height="{length_bottom-length_top:.0f}"
              rx="28" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="{-hw:.0f}" y="{length_top:.0f}" width="{hw*2:.0f}" height="{headboard_bottom-length_top:.0f}"
              rx="20" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="5" opacity="0.6"/>
        {pillows_svg}
        <path d="M {-hw+30:.0f} {length_bottom-160:.0f} Q 0 {length_bottom-210:.0f} {hw-30:.0f} {length_bottom-160:.0f}"
              fill="none" stroke="{_ACCENT}" stroke-width="6" opacity="0.7"/>
        <line x1="{-hw:.0f}" y1="{length_bottom-150:.0f}" x2="{hw:.0f}" y2="{length_bottom-150:.0f}"
              stroke="{_STROKE}" stroke-width="6"/>
    '''


def _seating_symbol(half_width: float, half_depth: float, seat_count: int, has_arms: bool) -> str:
    """A sofa/armchair: frame, rolled arms (if any), and individual seat-
    cushion divisions so multi-seat sofas visibly read as N seats, not one
    undifferentiated block."""
    w, d = half_width, half_depth
    arm_w = 90 if has_arms else 0
    parts = [
        f'<rect x="{-w:.0f}" y="{-d:.0f}" width="{w*2:.0f}" height="{d*2:.0f}" rx="{min(60, d*0.4):.0f}" '
        f'fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>',
        # back cushion band
        f'<rect x="{-w+arm_w+20:.0f}" y="{-d+20:.0f}" width="{w*2-2*(arm_w+20):.0f}" height="{d*0.55:.0f}" '
        f'rx="30" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="5" opacity="0.55"/>',
    ]
    if has_arms:
        parts.append(
            f'<rect x="{-w:.0f}" y="{-d:.0f}" width="{arm_w:.0f}" height="{d*2:.0f}" rx="30" '
            f'fill="none" stroke="{_STROKE}" stroke-width="8"/>'
        )
        parts.append(
            f'<rect x="{w-arm_w:.0f}" y="{-d:.0f}" width="{arm_w:.0f}" height="{d*2:.0f}" rx="30" '
            f'fill="none" stroke="{_STROKE}" stroke-width="8"/>'
        )
    # seat cushion divisions
    seat_zone_w = w * 2 - 2 * (arm_w + 10)
    seat_w = seat_zone_w / seat_count
    x0 = -w + arm_w + 10
    for i in range(1, seat_count):
        x = x0 + i * seat_w
        parts.append(f'<line x1="{x:.0f}" y1="{-d+d*0.5:.0f}" x2="{x:.0f}" y2="{d-20:.0f}" '
                      f'stroke="{_ACCENT}" stroke-width="5" opacity="0.6"/>')
    return "".join(parts)


SYMBOLS: dict[FurnitureCategory, str] = {
    FurnitureCategory.BED: _bed_symbol(half_width=450, pillow_count=1),
    FurnitureCategory.QUEEN_BED: _bed_symbol(half_width=480, pillow_count=2),
    FurnitureCategory.KING_BED: _bed_symbol(half_width=490, pillow_count=2),

    FurnitureCategory.SOFA: _seating_symbol(half_width=480, half_depth=250, seat_count=3, has_arms=True),
    FurnitureCategory.ARMCHAIR: _seating_symbol(half_width=260, half_depth=260, seat_count=1, has_arms=True),

    FurnitureCategory.DINING_TABLE: f'''
        <rect x="-480" y="-300" width="960" height="600" rx="24" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-430" y="-250" width="860" height="500" rx="16" fill="none" stroke="{_ACCENT}" stroke-width="4" opacity="0.5"/>
    ''',
    FurnitureCategory.DINING_CHAIR: f'''
        <rect x="-220" y="-220" width="440" height="440" rx="70" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <path d="M -190 -220 Q 0 -280 190 -220" fill="none" stroke="{_ACCENT}" stroke-width="8" opacity="0.7"/>
        <rect x="-150" y="-120" width="300" height="260" rx="50" fill="{_FILL_2}" stroke="none" opacity="0.4"/>
    ''',
    FurnitureCategory.COFFEE_TABLE: f'''
        <rect x="-350" y="-250" width="700" height="500" rx="70" fill="{_FILL}" stroke="{_STROKE}" stroke-width="8"/>
        <rect x="-280" y="-180" width="560" height="360" rx="50" fill="none" stroke="{_ACCENT}" stroke-width="4" opacity="0.5"/>
    ''',
    FurnitureCategory.TV_UNIT: f'''
        <rect x="-500" y="-100" width="1000" height="200" rx="14" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <line x1="-330" y1="-100" x2="-330" y2="100" stroke="{_ACCENT}" stroke-width="5" opacity="0.6"/>
        <line x1="330" y1="-100" x2="330" y2="100" stroke="{_ACCENT}" stroke-width="5" opacity="0.6"/>
        <rect x="-260" y="-55" width="180" height="110" rx="8" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="3" opacity="0.6"/>
        <rect x="80" y="-55" width="180" height="110" rx="8" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="3" opacity="0.6"/>
    ''',
    FurnitureCategory.WARDROBE: f'''
        <rect x="-500" y="-300" width="1000" height="600" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <line x1="0" y1="-300" x2="0" y2="300" stroke="{_STROKE}" stroke-width="6"/>
        <line x1="-250" y1="-260" x2="-250" y2="260" stroke="{_ACCENT}" stroke-width="4" opacity="0.5"/>
        <line x1="250" y1="-260" x2="250" y2="260" stroke="{_ACCENT}" stroke-width="4" opacity="0.5"/>
        <circle cx="-40" cy="0" r="14" fill="{_ACCENT}"/>
        <circle cx="40" cy="0" r="14" fill="{_ACCENT}"/>
    ''',
    FurnitureCategory.DESK: f'''
        <rect x="-480" y="-250" width="960" height="500" rx="14" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-420" y="-190" width="280" height="120" rx="8" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="3" opacity="0.6"/>
        <rect x="-420" y="-40" width="280" height="120" rx="8" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="3" opacity="0.6"/>
        <rect x="140" y="-160" width="280" height="180" rx="10" fill="none" stroke="{_ACCENT}" stroke-width="5" opacity="0.6"/>
    ''',
    FurnitureCategory.KITCHEN_COUNTER: f'''
        <rect x="-500" y="-250" width="1000" height="500" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <line x1="-166" y1="-250" x2="-166" y2="250" stroke="{_ACCENT}" stroke-width="4" opacity="0.45"/>
        <line x1="166" y1="-250" x2="166" y2="250" stroke="{_ACCENT}" stroke-width="4" opacity="0.45"/>
        <circle cx="-260" cy="-60" r="55" fill="none" stroke="{_ACCENT}" stroke-width="6"/>
        <circle cx="-100" cy="-60" r="55" fill="none" stroke="{_ACCENT}" stroke-width="6"/>
        <circle cx="-260" cy="90" r="55" fill="none" stroke="{_ACCENT}" stroke-width="6"/>
        <circle cx="-100" cy="90" r="55" fill="none" stroke="{_ACCENT}" stroke-width="6"/>
    ''',
    FurnitureCategory.SINK: f'''
        <rect x="-350" y="-250" width="700" height="500" rx="30" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <ellipse cx="0" cy="20" rx="220" ry="160" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="6" opacity="0.7"/>
        <rect x="-30" y="-220" width="60" height="70" rx="16" fill="none" stroke="{_ACCENT}" stroke-width="8"/>
        <circle cx="0" cy="30" r="10" fill="{_ACCENT}"/>
    ''',
    FurnitureCategory.WC: f'''
        <ellipse cx="0" cy="150" rx="280" ry="320" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <ellipse cx="0" cy="150" rx="190" ry="230" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="5" opacity="0.6"/>
        <rect x="-220" y="-450" width="440" height="320" rx="40" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-220" y="-450" width="440" height="90" rx="30" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="4" opacity="0.5"/>
    ''',
    FurnitureCategory.BATHTUB: f'''
        <rect x="-480" y="-280" width="960" height="560" rx="130" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-410" y="-210" width="820" height="420" rx="100" fill="{_FILL_2}" stroke="{_ACCENT}" stroke-width="5" opacity="0.55"/>
        <rect x="-440" y="-40" width="70" height="80" rx="16" fill="none" stroke="{_ACCENT}" stroke-width="8"/>
        <circle cx="-405" cy="0" r="8" fill="{_ACCENT}"/>
    ''',
    FurnitureCategory.GENERIC: f'''
        <rect x="-450" y="-450" width="900" height="900" rx="40" fill="{_FILL}" stroke="{_STROKE}" stroke-width="8" stroke-dasharray="24 14"/>
    ''',
}


def symbol_for(category: FurnitureCategory) -> str:
    return SYMBOLS.get(category, SYMBOLS[FurnitureCategory.GENERIC])
