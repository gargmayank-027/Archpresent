"""
app/services/theme.py

Theme + palette system. Ships one fully specced theme ("modern") end to
end through the renderer, matching the MVP-checkpoint scope. The other
five themes (Luxury, Scandinavian, Minimal, Traditional, Industrial) are
listed as metadata placeholders so a future theme picker can show them
as "coming soon" without any renderer code change required to add them
for real later. Ported unchanged from cad_service/theme.py.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.floorplan import RoomType


@dataclass
class RoomColorRole:
    floor: str
    wall_fill: str
    accent: str


@dataclass
class Theme:
    key: str
    name: str
    description: str
    available: bool
    wall_stroke_mm: float
    wall_stroke_color: str
    furniture_stroke_color: str
    furniture_fill_color: str
    room_label_color: str
    room_colors: dict[RoomType, RoomColorRole]
    shadow_enabled: bool = True
    shadow_opacity: float = 0.12
    # Sprint 4: two additional colors for presentation-quality asset detail
    # (cushion/pillow fills, seam/accent lines) — defaulted so the five
    # metadata-only placeholder themes below don't need updating just to
    # keep constructing.
    furniture_fill_secondary: str = "#F0F0F0"
    furniture_accent_color: str = "#B8B8B8"


_MODERN_ROOM_COLORS: dict[RoomType, RoomColorRole] = {
    RoomType.BEDROOM:      RoomColorRole("#E4EAF5", "#FAFBFD", "#7A93C4"),
    RoomType.LIVING:       RoomColorRole("#E6F2E9", "#FAFBFD", "#6FA97F"),
    RoomType.KITCHEN:      RoomColorRole("#FBF1DA", "#FAFBFD", "#C99A44"),
    RoomType.DINING:       RoomColorRole("#F8E7E2", "#FAFBFD", "#C17A63"),
    RoomType.BATHROOM:     RoomColorRole("#E4EEF0", "#FAFBFD", "#6E9098"),
    RoomType.DRESSING:     RoomColorRole("#EDE6F5", "#FAFBFD", "#8E72B0"),
    RoomType.POOJA:        RoomColorRole("#FBE9D6", "#FAFBFD", "#D08A3E"),
    RoomType.OUTDOOR:      RoomColorRole("#DEF2ED", "#FAFBFD", "#4FA593"),
    RoomType.LOBBY:        RoomColorRole("#F4F1E7", "#FAFBFD", "#A99A6B"),
    RoomType.STUDY:        RoomColorRole("#E2ECF7", "#FAFBFD", "#5C82B8"),
    RoomType.UTILITY:      RoomColorRole("#ECECEC", "#FAFBFD", "#8C8C8C"),
    RoomType.UNCLASSIFIED: RoomColorRole("#EFEFEF", "#FAFBFD", "#999999"),
}

_THEMES: dict[str, Theme] = {
    "modern": Theme(
        key="modern",
        name="Modern",
        description="Clean lines, light neutral walls, confident muted room tints.",
        available=True,
        wall_stroke_mm=6.0,
        wall_stroke_color="#2B2B2B",
        furniture_stroke_color="#4A4A4A",
        furniture_fill_color="#FFFFFF",
        room_label_color="#2B2B2B",
        room_colors=_MODERN_ROOM_COLORS,
        shadow_enabled=True,
        shadow_opacity=0.12,
        furniture_fill_secondary="#E9EBEE",
        furniture_accent_color="#9AA1AC",
    ),
    # Metadata-only placeholders — not yet renderable. Adding the real
    # definition later requires no renderer changes.
    "luxury":       Theme("luxury", "Luxury", "Rich tones, generous whitespace.", False, 6.0, "#1A1A1A", "#333", "#fff", "#1A1A1A", _MODERN_ROOM_COLORS),
    "scandinavian": Theme("scandinavian", "Scandinavian", "Pale woods, airy minimalism.", False, 6.0, "#333", "#333", "#fff", "#333", _MODERN_ROOM_COLORS),
    "minimal":      Theme("minimal", "Minimal", "Fewest colors, most whitespace.", False, 6.0, "#333", "#333", "#fff", "#333", _MODERN_ROOM_COLORS),
    "traditional":  Theme("traditional", "Traditional", "Warm, classic, timeless.", False, 6.0, "#333", "#333", "#fff", "#333", _MODERN_ROOM_COLORS),
    "industrial":   Theme("industrial", "Industrial", "Bold, high-contrast, raw.", False, 6.0, "#333", "#333", "#fff", "#333", _MODERN_ROOM_COLORS),
}


def list_themes() -> list[dict]:
    return [
        {"key": t.key, "name": t.name, "description": t.description, "available": t.available}
        for t in _THEMES.values()
    ]


def resolve_theme(key: str) -> Theme:
    theme = _THEMES.get(key)
    if theme is None or not theme.available:
        return _THEMES["modern"]
    return theme
