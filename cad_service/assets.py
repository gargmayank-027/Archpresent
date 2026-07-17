"""
cad_service/assets.py

The Asset Library (architecture doc §4), MVP scope. The renderer never
draws furniture procedurally per-instance — it places one of these
pre-authored symbols, exactly as the architecture doc requires. Each
symbol is normalized to a 1000x1000 design box centered at the origin
(-500..500 on each axis), top-down/plan view, matching the authoring
convention in §4.3 of the architecture doc.

**Honesty note:** these are simple, hand-authored placeholder symbols
(not final production illustration quality) so the end-to-end pipeline
— parse -> classify -> map -> place real SVG assets -> render — is
genuinely exercised and testable today. Swapping in higher-fidelity
artwork later is a per-category asset-file replacement, not a renderer
change, which is exactly the separation §4 of the architecture doc calls
for. Colors use `currentColor`-style CSS variables so the active theme's
furniture stroke/fill controls appearance without touching the symbol.
"""

from __future__ import annotations

from cad_service.ir_models import FurnitureCategory

_STROKE = "var(--furniture-stroke)"
_FILL = "var(--furniture-fill)"

SYMBOLS: dict[FurnitureCategory, str] = {
    FurnitureCategory.BED: f'''
        <rect x="-450" y="-480" width="900" height="960" rx="30" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-400" y="-430" width="380" height="220" rx="20" fill="none" stroke="{_STROKE}" stroke-width="8"/>
        <rect x="20" y="-430" width="380" height="220" rx="20" fill="none" stroke="{_STROKE}" stroke-width="8"/>
        <line x1="-450" y1="150" x2="450" y2="150" stroke="{_STROKE}" stroke-width="6"/>
    ''',
    FurnitureCategory.QUEEN_BED: f'''
        <rect x="-480" y="-480" width="960" height="960" rx="30" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-420" y="-430" width="380" height="220" rx="20" fill="none" stroke="{_STROKE}" stroke-width="8"/>
        <rect x="40" y="-430" width="380" height="220" rx="20" fill="none" stroke="{_STROKE}" stroke-width="8"/>
        <line x1="-480" y1="150" x2="480" y2="150" stroke="{_STROKE}" stroke-width="6"/>
    ''',
    FurnitureCategory.KING_BED: f'''
        <rect x="-490" y="-480" width="980" height="960" rx="30" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-440" y="-430" width="400" height="220" rx="20" fill="none" stroke="{_STROKE}" stroke-width="8"/>
        <rect x="40" y="-430" width="400" height="220" rx="20" fill="none" stroke="{_STROKE}" stroke-width="8"/>
        <line x1="-490" y1="150" x2="490" y2="150" stroke="{_STROKE}" stroke-width="6"/>
    ''',
    FurnitureCategory.SOFA: f'''
        <rect x="-480" y="-250" width="960" height="480" rx="40" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-480" y="-250" width="150" height="480" rx="30" fill="none" stroke="{_STROKE}" stroke-width="8"/>
        <rect x="330" y="-250" width="150" height="480" rx="30" fill="none" stroke="{_STROKE}" stroke-width="8"/>
        <line x1="-330" y1="-160" x2="330" y2="-160" stroke="{_STROKE}" stroke-width="6"/>
    ''',
    FurnitureCategory.ARMCHAIR: f'''
        <rect x="-260" y="-260" width="520" height="520" rx="60" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-260" y="-260" width="520" height="140" rx="40" fill="none" stroke="{_STROKE}" stroke-width="8"/>
    ''',
    FurnitureCategory.DINING_TABLE: f'''
        <rect x="-480" y="-300" width="960" height="600" rx="20" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
    ''',
    FurnitureCategory.DINING_CHAIR: f'''
        <rect x="-220" y="-220" width="440" height="440" rx="60" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-220" y="-220" width="440" height="100" rx="30" fill="none" stroke="{_STROKE}" stroke-width="6"/>
    ''',
    FurnitureCategory.COFFEE_TABLE: f'''
        <rect x="-350" y="-250" width="700" height="500" rx="60" fill="{_FILL}" stroke="{_STROKE}" stroke-width="8"/>
    ''',
    FurnitureCategory.TV_UNIT: f'''
        <rect x="-500" y="-100" width="1000" height="200" rx="10" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
    ''',
    FurnitureCategory.WARDROBE: f'''
        <rect x="-500" y="-300" width="1000" height="600" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <line x1="0" y1="-300" x2="0" y2="300" stroke="{_STROKE}" stroke-width="6"/>
    ''',
    FurnitureCategory.DESK: f'''
        <rect x="-480" y="-250" width="960" height="500" rx="10" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
    ''',
    FurnitureCategory.KITCHEN_COUNTER: f'''
        <rect x="-500" y="-250" width="1000" height="500" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <circle cx="-150" cy="0" r="80" fill="none" stroke="{_STROKE}" stroke-width="6"/>
        <circle cx="150" cy="0" r="80" fill="none" stroke="{_STROKE}" stroke-width="6"/>
    ''',
    FurnitureCategory.SINK: f'''
        <rect x="-350" y="-250" width="700" height="500" rx="30" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <ellipse cx="0" cy="0" rx="220" ry="150" fill="none" stroke="{_STROKE}" stroke-width="8"/>
    ''',
    FurnitureCategory.WC: f'''
        <ellipse cx="0" cy="150" rx="280" ry="320" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
        <rect x="-220" y="-450" width="440" height="320" rx="40" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
    ''',
    FurnitureCategory.BATHTUB: f'''
        <rect x="-480" y="-280" width="960" height="560" rx="120" fill="{_FILL}" stroke="{_STROKE}" stroke-width="10"/>
    ''',
    FurnitureCategory.GENERIC: f'''
        <rect x="-450" y="-450" width="900" height="900" rx="40" fill="{_FILL}" stroke="{_STROKE}" stroke-width="8" stroke-dasharray="24 14"/>
    ''',
}


def symbol_for(category: FurnitureCategory) -> str:
    return SYMBOLS.get(category, SYMBOLS[FurnitureCategory.GENERIC])
