"""tests/test_dxf_parser.py"""

from __future__ import annotations

import pytest

from app.services.dxf_parser import parse_dxf, DxfParseError


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
