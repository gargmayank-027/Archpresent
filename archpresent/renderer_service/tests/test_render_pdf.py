"""
tests/test_render_pdf.py

HTTP-level tests for POST /api/v1/render-pdf, plus a pipeline-level test
calling app.services.pdf_render_pipeline.run() directly. Needs pymupdf
installed (see requirements.txt) — unlike test_pdf_geometry.py and
test_ingest_pdf.py, this file builds its fixture PDF WITH PyMuPDF itself
(via Shape drawing), rather than a static fixture file, so there's
nothing extra to check into the repo (no tests/fixtures/*.pdf needed —
deliberately different from sample_apartment.dxf's approach, since a
synthetic vector PDF is cheap to generate on the fly and there's no
"real messy production file" equivalent worth pinning yet).
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

fitz = pytest.importorskip("fitz", reason="pymupdf not installed — see requirements.txt")

PAGE_W, PAGE_H = 800.0, 600.0
WALL_WIDTH = 8.0
THIN_WIDTH = 1.0


def _build_synthetic_plan_pdf() -> bytes:
    """Same 3-room synthetic plan used in test_pdf_geometry.py /
    test_ingest_pdf.py (Living | Bedroom over Kitchen, door gap in the
    vertical partition, a dimension line that must be filtered out as
    non-structural), but drawn as an actual PDF page via PyMuPDF so this
    test exercises the real pdf_vector_extract.py PyMuPDF adapter too."""
    doc = fitz.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)

    def wall_line(p1, p2):
        shape = page.new_shape()
        shape.draw_line(p1, p2)
        shape.finish(width=WALL_WIDTH, color=(0, 0, 0))
        shape.commit()

    def thin_line(p1, p2):
        shape = page.new_shape()
        shape.draw_line(p1, p2)
        shape.finish(width=THIN_WIDTH, color=(0.6, 0.6, 0.6))
        shape.commit()

    # Envelope
    wall_line((50, 50), (750, 50))
    wall_line((750, 50), (750, 550))
    wall_line((750, 550), (50, 550))
    wall_line((50, 550), (50, 50))
    # Vertical partition with a door gap between y=250 and y=290
    wall_line((400, 50), (400, 250))
    wall_line((400, 290), (400, 550))
    # Horizontal partition (right side only)
    wall_line((400, 300), (750, 300))
    # A thin dimension line — must be filtered out as non-structural
    thin_line((60, 40), (740, 40))

    page.insert_text((200, 300), "LIVING", fontsize=11)
    page.insert_text((545, 178), "BEDROOM", fontsize=11)
    page.insert_text((545, 428), "KITCHEN", fontsize=11)

    return doc.tobytes()


def _build_raster_only_pdf() -> bytes:
    """A PDF with a single embedded raster image and essentially no
    vector drawing content — should be rejected by the router as
    raster_unsupported, not silently mis-parsed."""
    doc = fitz.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    # A tiny solid-color PNG, stretched to fill most of the page.
    img_doc = fitz.open()
    img_page = img_doc.new_page(width=100, height=100)
    img_page.draw_rect(img_page.rect, color=(0.5, 0.5, 0.5), fill=(0.5, 0.5, 0.5))
    png_bytes = img_page.get_pixmap().tobytes("png")
    img_doc.close()
    page.insert_image(fitz.Rect(20, 20, 780, 580), stream=png_bytes)
    return doc.tobytes()


@pytest.fixture()
def synthetic_plan_pdf_bytes() -> bytes:
    return _build_synthetic_plan_pdf()


@pytest.fixture()
def synthetic_plan_pdf_file(synthetic_plan_pdf_bytes: bytes) -> io.BytesIO:
    return io.BytesIO(synthetic_plan_pdf_bytes)


# ── Pipeline-level (no HTTP) ────────────────────────────────────────────

def test_pipeline_finds_three_rooms(synthetic_plan_pdf_bytes: bytes):
    from app.services import pdf_render_pipeline

    result = pdf_render_pipeline.run(
        synthetic_plan_pdf_bytes, "synthetic.pdf", theme_key="modern", scale_override="1:1",
    )
    assert len(result.ir.rooms) == 3
    assert result.ir.provenance.source_format == "pdf_vector"
    assert "<svg" in result.svg


def test_pipeline_raises_on_page_out_of_range(synthetic_plan_pdf_bytes: bytes):
    from app.services import pdf_render_pipeline

    with pytest.raises(pdf_render_pipeline.PdfParseError):
        pdf_render_pipeline.run(synthetic_plan_pdf_bytes, "synthetic.pdf", page_index=5)


# ── HTTP-level ───────────────────────────────────────────────────────────

def test_render_pdf_valid_vector_pdf_returns_real_response(
    client: TestClient, synthetic_plan_pdf_file: io.BytesIO
) -> None:
    res = client.post(
        "/api/v1/render-pdf",
        files={"file": ("plan.pdf", synthetic_plan_pdf_file, "application/pdf")},
        data={"theme": "modern", "scale_override": "1:100"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["roomCount"] == 3
    assert body["wallCount"] > 0
    assert "<svg" in body["svg"]
    assert body["ir"]["provenance"]["sourceFormat"] == "pdf_vector" or \
        body["ir"]["provenance"]["source_format"] == "pdf_vector"


def test_render_pdf_rejects_non_pdf_extension(client: TestClient) -> None:
    res = client.post(
        "/api/v1/render-pdf",
        files={"file": ("plan.png", io.BytesIO(b"not a pdf"), "image/png")},
        data={"theme": "modern"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_request"


def test_render_pdf_rejects_empty_file(client: TestClient) -> None:
    res = client.post(
        "/api/v1/render-pdf",
        files={"file": ("plan.pdf", io.BytesIO(b""), "application/pdf")},
        data={"theme": "modern"},
    )
    assert res.status_code == 400


def test_render_pdf_rejects_raster_only_pdf(client: TestClient) -> None:
    raster_pdf = _build_raster_only_pdf()
    res = client.post(
        "/api/v1/render-pdf",
        files={"file": ("scan.pdf", io.BytesIO(raster_pdf), "application/pdf")},
        data={"theme": "modern"},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "raster_unsupported"


def test_render_pdf_without_scale_override_still_succeeds_with_warning(
    client: TestClient, synthetic_plan_pdf_file: io.BytesIO
) -> None:
    """No scale_override given -> honest 1:1 fallback + warning, not a
    rejected request (mirrors units.py's $INSUNITS=0 behavior)."""
    res = client.post(
        "/api/v1/render-pdf",
        files={"file": ("plan.pdf", synthetic_plan_pdf_file, "application/pdf")},
        data={"theme": "modern"},
    )
    assert res.status_code == 200
    body = res.json()
    codes = {w["code"] for w in body["warnings"]}
    assert "unknown_pdf_scale" in codes


def test_render_pdf_does_not_affect_dxf_endpoint(client: TestClient, dxf_file: io.BytesIO) -> None:
    """Sanity check that adding this endpoint left /api/v1/render (the
    DXF endpoint) completely untouched."""
    res = client.post(
        "/api/v1/render",
        files={"file": ("empty.dxf", dxf_file, "application/octet-stream")},
        data={"theme": "modern"},
    )
    assert res.status_code == 200
    assert res.json()["ok"] is True
