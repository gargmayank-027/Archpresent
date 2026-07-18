"""
tests/test_geometry_preservation.py

The single most important test file in this service. Sprint 4 replaced
the placeholder furniture symbols with detailed, presentation-quality
artwork (app/services/assets.py) — this test exists to prove that
change touched *only* what furniture looks like, never where it is.

The core guarantee under test: every furniture item and opening's
`<g transform="translate(x,y) rotate(r)">` in the rendered SVG must
match its IR's `insertion_point` / `rotation_deg` exactly (within
floating-point formatting tolerance). This must hold regardless of
theme, regardless of how detailed a symbol's internal markup is — the
renderer's only job is deciding how something looks, never where it is
(see archpresent-cad-renderer-v1-architecture.md §7).

If this test cannot pass for a given theme or asset change, that change
does not ship — this is a hard gate, not a style check.
"""

from __future__ import annotations

import re

import pytest

from app.services import render_pipeline

# Matches the exact transform format app/services/svg_renderer.py emits
# for both openings and furniture: translate(x,y) rotate(r)
_TRANSFORM_RE = re.compile(r'<g transform="translate\(([-\d.]+),([-\d.]+)\) rotate\(([-\d.]+)\)">')

# SVG formatting uses %.1f for coordinates — half the last-decimal step
# is the correct tolerance for "this is the same number, just formatted".
_COORD_TOLERANCE = 0.05
_ROTATION_TOLERANCE = 0.05


@pytest.fixture()
def result(sample_apartment_dxf_bytes: bytes):
    return render_pipeline.run(sample_apartment_dxf_bytes.decode("utf-8"), "sample_apartment.dxf", theme_key="modern")


def _extract_placed_transforms(svg: str) -> list[tuple[float, float, float]]:
    return [(float(x), float(y), float(r)) for x, y, r in _TRANSFORM_RE.findall(svg)]


def test_every_opening_and_furniture_item_has_a_placement_group(result) -> None:
    transforms = _extract_placed_transforms(result.svg)
    expected_count = len(result.ir.openings) + len(result.ir.furniture)
    assert len(transforms) == expected_count, (
        f"expected {expected_count} placed groups (openings + furniture), "
        f"found {len(transforms)} in the rendered SVG"
    )


def test_opening_positions_match_ir_exactly(result) -> None:
    transforms = _extract_placed_transforms(result.svg)
    opening_transforms = transforms[: len(result.ir.openings)]

    for opening, (gx, gy, gr) in zip(result.ir.openings, opening_transforms):
        assert abs(gx - opening.position.x) < _COORD_TOLERANCE, (opening.block_name, gx, opening.position.x)
        assert abs(gy - opening.position.y) < _COORD_TOLERANCE, (opening.block_name, gy, opening.position.y)
        assert abs(gr - opening.rotation_deg) < _ROTATION_TOLERANCE, (opening.block_name, gr, opening.rotation_deg)


def test_furniture_positions_match_ir_exactly(result) -> None:
    transforms = _extract_placed_transforms(result.svg)
    furniture_transforms = transforms[len(result.ir.openings):]

    for item, (gx, gy, gr) in zip(result.ir.furniture, furniture_transforms):
        assert abs(gx - item.insertion_point.x) < _COORD_TOLERANCE, (
            f"{item.block_name}: SVG x={gx} != IR x={item.insertion_point.x}"
        )
        assert abs(gy - item.insertion_point.y) < _COORD_TOLERANCE, (
            f"{item.block_name}: SVG y={gy} != IR y={item.insertion_point.y}"
        )
        assert abs(gr - item.rotation_deg) < _ROTATION_TOLERANCE, (
            f"{item.block_name}: SVG rotation={gr} != IR rotation={item.rotation_deg}"
        )


def test_geometry_preserved_across_every_available_theme(sample_apartment_dxf_bytes: bytes) -> None:
    """Placement must be theme-independent — a theme is only allowed to
    change colors/symbol style, never coordinates. Only "modern" is a
    real theme today (the rest are metadata placeholders that resolve
    back to "modern" — see app/services/theme.py), but this test is
    written to automatically cover every theme that becomes real later,
    with no changes needed here."""
    from app.services.theme import list_themes

    baseline = render_pipeline.run(sample_apartment_dxf_bytes.decode("utf-8"), "sample_apartment.dxf", theme_key="modern")
    baseline_transforms = _extract_placed_transforms(baseline.svg)

    for theme_meta in list_themes():
        result = render_pipeline.run(
            sample_apartment_dxf_bytes.decode("utf-8"), "sample_apartment.dxf", theme_key=theme_meta["key"]
        )
        transforms = _extract_placed_transforms(result.svg)
        assert transforms == baseline_transforms, (
            f"theme '{theme_meta['key']}' produced different furniture/opening placement "
            f"than 'modern' — themes must never affect geometry"
        )


def test_furniture_symbol_scale_reflects_footprint_and_ir_scale(result) -> None:
    """The scale applied to each symbol (<g transform="scale(sx,sy)">,
    nested inside the placement group) must equal
    (footprint_mm / 1000) * scale_x/scale_y from the IR — this is the
    other half of "geometry preserved exactly" (size, not just position)."""
    scale_re = re.compile(r'<g transform="scale\(([-\d.]+),([-\d.]+)\)">')
    scales = [(float(sx), float(sy)) for sx, sy in scale_re.findall(result.svg)]

    assert len(scales) == len(result.ir.furniture)
    for item, (sx, sy) in zip(result.ir.furniture, scales):
        expected_sx = (item.footprint_mm[0] / 1000.0) * item.scale_x
        expected_sy = (item.footprint_mm[1] / 1000.0) * item.scale_y
        assert abs(sx - expected_sx) < 0.001, (item.block_name, sx, expected_sx)
        assert abs(sy - expected_sy) < 0.001, (item.block_name, sy, expected_sy)
