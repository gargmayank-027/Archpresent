"""
tests/test_render.py

HTTP-level tests for POST /api/v1/render. Validation-failure cases are
unchanged from Sprint 1 (same code path); success-case assertions are
rewritten for the real response shape now that Sprint 2 wires in the
actual pipeline.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient


def test_render_valid_dxf_returns_real_response(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
        data={"theme": "modern"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["theme"] == "modern"
    assert body["roomCount"] == 2
    assert body["furnitureCount"] == 3
    assert body["wallCount"] == 2
    assert "<svg" in body["svg"]
    assert isinstance(body["ir"], dict)
    assert len(body["rooms"]) == 2

    room_names = {r["name"] for r in body["rooms"]}
    assert room_names == {"Living Room", "Bedroom 1"}
    for room in body["rooms"]:
        assert 0.0 <= room["boundingBox"]["x"] <= 1.0
        assert 0.0 <= room["boundingBox"]["width"] <= 1.0


def test_render_defaults_theme_to_modern(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
    )
    assert res.status_code == 200
    assert res.json()["theme"] == "modern"


def test_render_unknown_theme_falls_back_to_modern(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
        data={"theme": "not_a_real_theme"},
    )
    assert res.status_code == 200
    assert res.json()["theme"] == "modern"


def test_render_empty_but_structurally_valid_dxf_still_succeeds(client: TestClient, dxf_file: io.BytesIO) -> None:
    # A DXF with a valid (empty) ENTITIES section is a real, if degenerate,
    # case — zero rooms/walls/furniture, not a rejected request.
    res = client.post(
        "/api/v1/render",
        files={"file": ("empty_but_valid.dxf", dxf_file, "application/octet-stream")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["roomCount"] == 1  # whole-plan fallback room
    assert body["wallCount"] == 0
    assert any(w["code"] == "no_room_boundaries_found" for w in body["warnings"])


def test_render_rejects_wrong_extension(client: TestClient) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample.txt", io.BytesIO(b"not a dxf"), "text/plain")},
    )
    assert res.status_code == 400
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_request"


def test_render_rejects_empty_file(client: TestClient) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("empty.dxf", io.BytesIO(b""), "application/octet-stream")},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_request"


def test_render_rejects_content_that_is_not_dxf_at_all(client: TestClient) -> None:
    # Right extension, but garbage content — should be a dxf_parse_error,
    # not a 500 or a silent empty success.
    res = client.post(
        "/api/v1/render",
        files={"file": ("garbage.dxf", io.BytesIO(b"this is not dxf group-code format"), "application/octet-stream")},
    )
    assert res.status_code == 422
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "dxf_parse_error"


def test_render_rejects_oversized_file(client: TestClient, monkeypatch) -> None:
    from app.config.settings import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "max_upload_size_mb", 0)

    oversized = io.BytesIO(b"x" * 1024)
    res = client.post(
        "/api/v1/render",
        files={"file": ("big.dxf", oversized, "application/octet-stream")},
    )
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "file_too_large"


def test_render_missing_file_returns_422(client: TestClient) -> None:
    res = client.post("/api/v1/render", data={"theme": "modern"})
    assert res.status_code == 422
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_request"


# ── unit_override (see app/services/units.py) ───────────────────────────

def test_render_accepts_valid_unit_override(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
        data={"theme": "modern", "unit_override": "in"},
    )
    assert res.status_code == 200
    body = res.json()
    assert any(w["code"] == "unit_override_applied" for w in body["warnings"])
    # 20 sqm (mm-interpreted) * 25.4^2 -- proves the override actually changed the geometry
    assert body["rooms"][0]["sizeEstimateSqm"] == pytest.approx(20.0 * 25.4 ** 2, rel=0.01)


def test_render_rejects_invalid_unit_override(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
        data={"theme": "modern", "unit_override": "furlongs"},
    )
    assert res.status_code == 400
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_request"


def test_render_without_unit_override_is_unaffected(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
        data={"theme": "modern"},
    )
    assert res.status_code == 200
    body = res.json()
    assert not any(w["code"] == "unit_override_applied" for w in body["warnings"])
    assert body["rooms"][0]["sizeEstimateSqm"] == pytest.approx(20.0, abs=0.1)


# ── block_overrides (see app/services/block_mapper.py) ─────────────────

def test_render_reports_unmapped_block_names(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
    )
    assert res.status_code == 200
    body = res.json()
    # sample_apartment.dxf's furniture (SOFA, DINING_TABLE, QUEEN_BED) all
    # match known patterns -- nothing should be unmapped for this fixture.
    assert body["unmappedBlockNames"] == []


def test_render_accepts_valid_block_overrides(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    import json
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
        data={"theme": "modern", "block_overrides": json.dumps({"SOFA": "armchair"})},
    )
    assert res.status_code == 200
    ir = res.json()["ir"]
    sofa_items = [f for f in ir["furniture"] if f["block_name"] == "SOFA"]
    assert len(sofa_items) == 1
    assert sofa_items[0]["category"] == "armchair"
    assert sofa_items[0]["mapping_stage"] == 1  # exact override


def test_render_rejects_malformed_block_overrides_json(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
        data={"theme": "modern", "block_overrides": "{not valid json"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_request"


def test_render_rejects_invalid_block_override_category(client: TestClient, sample_apartment_dxf_file: io.BytesIO) -> None:
    import json
    res = client.post(
        "/api/v1/render",
        files={"file": ("sample_apartment.dxf", sample_apartment_dxf_file, "application/octet-stream")},
        data={"theme": "modern", "block_overrides": json.dumps({"SOFA": "not_a_real_category"})},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_request"
