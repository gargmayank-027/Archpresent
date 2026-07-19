"""
app/services/pdf_vector_extract.py

The ONLY module in the PDF/image engine that imports PyMuPDF (`fitz`).
Everything downstream of this module (pdf_geometry.py, ingest_pdf.py)
works on the plain-dataclass raw types defined here, so this is the
single seam to touch if the PDF library ever changes — same isolation
principle `dxf_parser.py` gives the DXF engine's ASCII-DXF reader.

PyMuPDF is imported lazily (inside functions), so the rest of the PDF
engine (geometry reasoning, IR assembly) imports and unit-tests cleanly
even in an environment without `pymupdf` installed.

PyMuPDF API this module relies on:
  - `page.get_drawings()` -> vector paths; each path's `items` list holds
    draw commands `("l", p1, p2)` / `("re", rect, orient)` / `("qu", quad)`
    / `("c", p1, p2, p3, p4)`, plus per-path `width` (stroke width) and
    `type` ("s"/"f"/"fs" — stroke/fill/both).
  - `page.get_text("blocks")` -> `(x0, y0, x1, y1, text, block_no, type)`
    tuples — used instead of `"words"` so a multi-word room label like
    "MASTER BEDROOM" comes back as one label, not two.
  - `page.get_images(full=True)` / `page.get_image_rects(xref)` -> embedded
    bitmap images and the area(s) they cover, used only for the
    vector-vs-raster page-stats decision (pdf_router.py), never parsed
    further in this V1 vector-only path.
  - `fitz.open(stream=..., filetype="pdf")` to open from raw bytes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple


# --------------------------------------------------------------------------- #
# Raw, PyMuPDF-independent geometry types
# --------------------------------------------------------------------------- #

@dataclass
class RawSegment:
    """A single stroked line segment from a vector path, in PDF page-point
    coordinates (origin top-left, matching PyMuPDF's convention)."""
    x0: float
    y0: float
    x1: float
    y1: float
    width: float = 1.0
    is_fill: bool = False

    @property
    def length(self) -> float:
        return ((self.x1 - self.x0) ** 2 + (self.y1 - self.y0) ** 2) ** 0.5

    @property
    def is_horizontal(self) -> bool:
        return abs(self.y1 - self.y0) <= abs(self.x1 - self.x0) * 0.05

    @property
    def is_vertical(self) -> bool:
        return abs(self.x1 - self.x0) <= abs(self.y1 - self.y0) * 0.05


@dataclass
class RawRect:
    x0: float
    y0: float
    x1: float
    y1: float
    width: float = 1.0
    is_fill: bool = False

    @property
    def area(self) -> float:
        return abs(self.x1 - self.x0) * abs(self.y1 - self.y0)


@dataclass
class RawText:
    """A text block from the PDF's own text layer (not OCR)."""
    text: str
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2.0

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2.0


@dataclass
class PageGeometry:
    page_width_pt: float
    page_height_pt: float
    segments: List[RawSegment] = field(default_factory=list)
    rects: List[RawRect] = field(default_factory=list)
    texts: List[RawText] = field(default_factory=list)
    excluded_regions: List[Tuple[float, float, float, float]] = field(default_factory=list)


@dataclass
class PageStats:
    """Cheap signals used by pdf_router.py to decide vector-vs-raster
    BEFORE committing to full extraction."""
    drawing_count: int = 0
    segment_count: int = 0
    text_block_count: int = 0
    raster_image_count: int = 0
    raster_image_area_ratio: float = 0.0
    page_width_pt: float = 0.0
    page_height_pt: float = 0.0
    is_native_image: bool = False  # input was PNG/JPG, not a PDF


class PdfOpenError(Exception):
    """The file could not be opened as a PDF at all (corrupt / not a PDF)."""


def _require_fitz():
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "PyMuPDF (pymupdf) is required for the PDF vector engine. "
            "Install it in this service's environment: pip install pymupdf"
        ) from exc
    return fitz


def _open(data: bytes):
    fitz = _require_fitz()
    try:
        return fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 — any open failure is a content problem
        raise PdfOpenError(f"Could not open file as a PDF: {exc}") from exc


# --------------------------------------------------------------------------- #
# Cheap stats (router input — no full extraction yet)
# --------------------------------------------------------------------------- #

def page_stats(data: bytes, page_index: int = 0) -> PageStats:
    doc = _open(data)
    if page_index >= len(doc):
        raise PdfOpenError(f"Page index {page_index} out of range (document has {len(doc)} page(s)).")
    page = doc[page_index]
    rect = page.rect
    drawings = page.get_drawings()

    seg_count = 0
    for path in drawings:
        for item in path.get("items", []):
            if item[0] in ("l", "re", "qu", "c"):
                seg_count += 1

    blocks = page.get_text("blocks")
    page_area = max(rect.width * rect.height, 1.0)
    bitmap_area = 0.0
    images = page.get_images(full=True)
    for img in images:
        xref = img[0]
        for r in page.get_image_rects(xref):
            bitmap_area += r.width * r.height

    return PageStats(
        drawing_count=len(drawings),
        segment_count=seg_count,
        text_block_count=len(blocks),
        raster_image_count=len(images),
        raster_image_area_ratio=min(bitmap_area / page_area, 1.0),
        page_width_pt=rect.width,
        page_height_pt=rect.height,
        is_native_image=False,
    )


# --------------------------------------------------------------------------- #
# Full vector geometry extraction
# --------------------------------------------------------------------------- #

def extract_page_geometry(data: bytes, page_index: int = 0) -> PageGeometry:
    doc = _open(data)
    if page_index >= len(doc):
        raise PdfOpenError(f"Page index {page_index} out of range (document has {len(doc)} page(s)).")
    page = doc[page_index]
    rect = page.rect

    segments: List[RawSegment] = []
    rects: List[RawRect] = []

    for path in page.get_drawings():
        width = float(path.get("width") or 1.0)
        is_fill = path.get("type") in ("f", "fs")
        for item in path.get("items", []):
            kind = item[0]
            if kind == "l":
                p1, p2 = item[1], item[2]
                segments.append(RawSegment(p1.x, p1.y, p2.x, p2.y, width, is_fill))
            elif kind == "re":
                r = item[1]
                rects.append(RawRect(r.x0, r.y0, r.x1, r.y1, width, is_fill))
                segments.append(RawSegment(r.x0, r.y0, r.x1, r.y0, width, is_fill))
                segments.append(RawSegment(r.x1, r.y0, r.x1, r.y1, width, is_fill))
                segments.append(RawSegment(r.x1, r.y1, r.x0, r.y1, width, is_fill))
                segments.append(RawSegment(r.x0, r.y1, r.x0, r.y0, width, is_fill))
            elif kind == "qu":
                q = item[1]
                pts = [q.ul, q.ur, q.lr, q.ll, q.ul]
                for a, b in zip(pts, pts[1:]):
                    segments.append(RawSegment(a.x, a.y, b.x, b.y, width, is_fill))
            # bezier ("c") segments are skipped in V1 — arcs are almost
            # always door swings, which the opening-gap heuristic already
            # covers without needing curve geometry; treating them as
            # walls would be actively wrong.

    texts: List[RawText] = []
    for block in page.get_text("blocks"):
        x0, y0, x1, y1, text = block[0], block[1], block[2], block[3], block[4]
        cleaned = " ".join(text.split())
        if cleaned:
            texts.append(RawText(cleaned, x0, y0, x1, y1))

    excluded = _detect_title_block(rect.width, rect.height)

    return PageGeometry(
        page_width_pt=rect.width,
        page_height_pt=rect.height,
        segments=segments,
        rects=rects,
        texts=texts,
        excluded_regions=excluded,
    )


def _detect_title_block(w: float, h: float) -> List[Tuple[float, float, float, float]]:
    """Heuristic title-block exclusion (right margin / bottom strip) —
    mirrors the lesson already proven in `components/FloodFillRenderer.tsx`
    ("plan boundary detection explicitly excludes the title block"): a
    title block's border lines and text otherwise pollute wall and room
    detection. A learned title-block detector is a later enhancement;
    this margin heuristic is honest about being approximate."""
    return [
        (w * 0.82, 0.0, w, h),   # right strip
        (0.0, h * 0.88, w, h),   # bottom strip
    ]
