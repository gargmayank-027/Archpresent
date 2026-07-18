"""tests/test_dxf_parser.py"""

from __future__ import annotations

import pytest

from app.services.dxf_parser import parse_dxf, DxfParseError, clean_mtext


def test_parses_entities(sample_apartment_dxf_bytes: bytes) -> None:
    raw = parse_dxf(sample_apartment_dxf_bytes.decode("utf-8"))
    types = [e.dxftype for e in raw.entities]
    assert "LWPOLYLINE" in types
    assert "LINE" in types
    assert "INSERT" in types
    assert "TEXT" in types


def test_insunits_parsed(sample_apartment_dxf_bytes: bytes) -> None:
    raw = parse_dxf(sample_apartment_dxf_bytes.decode("utf-8"))
    assert raw.insunits == 4  # millimeters


def test_empty_input_raises() -> None:
    with pytest.raises(DxfParseError):
        parse_dxf("")


def test_no_entities_section_produces_warning() -> None:
    raw = parse_dxf("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n")
    assert any(w.code == "no_entities_found" for w in raw.warnings)
    assert raw.entities == []


# ── MTEXT formatting-code cleaning ──────────────────────────────────────
# Motivated by a real file where room labels like
# \A1;TOILET-1 6'-6"X13'-10{\H0.7x;\S1/2;}" were showing up verbatim in
# the UI instead of "TOILET-1 6'-6"X13'-10 1/2"".

def test_clean_mtext_strips_alignment_code() -> None:
    assert clean_mtext("\\A1;CONSOLE") == "CONSOLE"


def test_clean_mtext_strips_height_code_inside_braces() -> None:
    assert clean_mtext("LIFT{\\H0.7x;}") == "LIFT"


def test_clean_mtext_converts_stacked_fraction_with_leading_space() -> None:
    bs = chr(92)
    raw = f"13'-10{{{bs}H0.7x;{bs}S1/2;}}\""
    assert clean_mtext(raw) == "13'-10 1/2\""


def test_clean_mtext_handles_full_real_world_label() -> None:
    bs = chr(92)
    raw = f"{bs}A1;TOILET-1 6'-6\"X13'-10{{{bs}H0.7x;{bs}S1/2;}}\""
    assert clean_mtext(raw) == "TOILET-1 6'-6\"X13'-10 1/2\""


def test_clean_mtext_paragraph_break_becomes_space() -> None:
    assert clean_mtext("LINE ONE\\PLINE TWO") == "LINE ONE LINE TWO"


def test_clean_mtext_preserves_escaped_literal_braces() -> None:
    assert clean_mtext("A\\{literal\\}B") == "A{literal}B"


def test_clean_mtext_plain_text_is_unaffected() -> None:
    assert clean_mtext("KITCHEN 14'-0\"X13'-0\"") == "KITCHEN 14'-0\"X13'-0\""


def test_clean_mtext_empty_string_returns_empty() -> None:
    assert clean_mtext("") == ""


def test_clean_mtext_collapses_double_spaces_from_stripped_codes() -> None:
    assert clean_mtext("A\\C2;  B") == "A B"
