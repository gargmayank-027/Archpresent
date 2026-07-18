"""tests/test_units.py"""

from __future__ import annotations

from app.services.units import units_factor, UNIT_OVERRIDE_TO_MM
from app.models.floorplan import ParseWarning


def test_default_mm_insunits_returns_factor_1():
    warnings: list[ParseWarning] = []
    assert units_factor(4, warnings) == 1.0
    assert warnings == []


def test_insunits_inches_returns_25_4():
    warnings: list[ParseWarning] = []
    assert units_factor(1, warnings) == 25.4
    assert warnings == []


def test_unrecognized_insunits_warns_and_defaults_to_mm():
    warnings: list[ParseWarning] = []
    factor = units_factor(999, warnings)
    assert factor == 1.0
    assert any(w.code == "unrecognized_insunits" for w in warnings)


def test_unitless_insunits_warns():
    warnings: list[ParseWarning] = []
    units_factor(0, warnings)
    assert any(w.code == "unitless_insunits" for w in warnings)


def test_override_takes_precedence_over_insunits():
    """The whole point of the override: it must win even when $INSUNITS
    itself is a normally-valid value (e.g. 4/mm) — that's exactly the
    real-world case that motivated this feature (header says mm, file
    is actually inches)."""
    warnings: list[ParseWarning] = []
    factor = units_factor(4, warnings, unit_override="in")
    assert factor == 25.4
    assert any(w.code == "unit_override_applied" for w in warnings)


def test_all_override_keys_produce_expected_factors():
    warnings: list[ParseWarning] = []
    assert units_factor(4, warnings, unit_override="mm") == 1.0
    assert units_factor(4, warnings, unit_override="cm") == 10.0
    assert units_factor(4, warnings, unit_override="m") == 1000.0
    assert units_factor(4, warnings, unit_override="in") == 25.4
    assert units_factor(4, warnings, unit_override="ft") == 304.8


def test_override_is_case_insensitive_and_trims_whitespace():
    warnings: list[ParseWarning] = []
    assert units_factor(4, warnings, unit_override=" IN ") == 25.4


def test_invalid_override_falls_back_to_insunits_with_warning():
    warnings: list[ParseWarning] = []
    factor = units_factor(4, warnings, unit_override="furlongs")
    assert factor == 1.0  # falls back to $INSUNITS=4 (mm)
    assert any(w.code == "invalid_unit_override" for w in warnings)


def test_none_override_behaves_exactly_like_no_override():
    warnings: list[ParseWarning] = []
    assert units_factor(4, warnings, unit_override=None) == 1.0
    assert warnings == []


def test_override_keys_are_the_documented_five():
    assert set(UNIT_OVERRIDE_TO_MM.keys()) == {"mm", "cm", "m", "in", "ft"}
