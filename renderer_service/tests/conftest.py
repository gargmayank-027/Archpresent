"""
tests/conftest.py

Shared fixtures for the renderer_service test suite.
"""

from __future__ import annotations

import io
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
SAMPLE_APARTMENT_PATH = os.path.join(FIXTURES_DIR, "sample_apartment.dxf")


@pytest.fixture()
def client() -> TestClient:
    """A fresh TestClient per test. FastAPI's TestClient runs the app
    in-process (no real network socket), so this stays fast and needs no
    running server."""
    return TestClient(app)


@pytest.fixture()
def minimal_dxf_bytes() -> bytes:
    """A structurally valid but empty DXF (valid ENTITIES section, zero
    entities in it). Since Sprint 2, this now actually parses
    successfully — an empty drawing is a real, if degenerate, case (see
    tests/test_render.py), not something the pipeline rejects."""
    return b"0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"


@pytest.fixture()
def dxf_file(minimal_dxf_bytes: bytes) -> io.BytesIO:
    return io.BytesIO(minimal_dxf_bytes)


@pytest.fixture()
def sample_apartment_dxf_bytes() -> bytes:
    """The real two-room test fixture (Living Room + Bedroom 1, walls,
    door, window, sofa/dining table/queen bed) — same file used
    throughout cad_service/'s test suite, copied here so this service's
    tests are self-contained."""
    with open(SAMPLE_APARTMENT_PATH, "rb") as f:
        return f.read()


@pytest.fixture()
def sample_apartment_dxf_file(sample_apartment_dxf_bytes: bytes) -> io.BytesIO:
    return io.BytesIO(sample_apartment_dxf_bytes)
