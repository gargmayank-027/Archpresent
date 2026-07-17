"""
cad_service/dxf_parser.py

Minimal ASCII DXF (group-code) reader, stdlib only. Covers the entity
subset V1 needs: LINE, LWPOLYLINE (straight segments only — bulge/arc
segments are not supported in this MVP and are logged as a warning),
INSERT (blocks: furniture, doors, windows), TEXT/MTEXT (room labels).

This is explicitly a substitute for `ezdxf.readfile()` (see README.md for
the swap rationale). It intentionally supports only modern ASCII DXF
(R2000+) LWPOLYLINE-style entities, not the legacy POLYLINE/VERTEX/SEQEND
triplet — a documented V1 MVP limitation, not an oversight.

Units: assumes millimetres unless $INSUNITS is found and recognized;
falls back to millimetres with a warning otherwise (see `units.py`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from cad_service.ir_models import ParseWarning


class DxfParseError(Exception):
    """Hard failure — the file could not be read at all."""


@dataclass
class RawEntity:
    """One DXF entity: its type name plus all (group_code, value) pairs."""
    dxftype: str
    codes: list[tuple[int, str]] = field(default_factory=list)

    def get(self, code: int, default=None):
        for c, v in self.codes:
            if c == code:
                return v
        return default

    def get_all(self, code: int) -> list[str]:
        return [v for c, v in self.codes if c == code]

    def get_float(self, code: int, default: float = 0.0) -> float:
        v = self.get(code)
        try:
            return float(v) if v is not None else default
        except ValueError:
            return default

    def get_int(self, code: int, default: int = 0) -> int:
        v = self.get(code)
        try:
            return int(float(v)) if v is not None else default
        except ValueError:
            return default


@dataclass
class RawDxfDocument:
    entities: list[RawEntity]
    insunits: int = 4  # 4 = millimeters (DXF header code default)
    warnings: list[ParseWarning] = field(default_factory=list)


def _read_group_code_pairs(text: str) -> list[tuple[int, str]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() != ""]
    if len(lines) % 2 != 0:
        # Malformed — drop the trailing dangling code, keep parsing.
        lines = lines[:-1]
    pairs: list[tuple[int, str]] = []
    for i in range(0, len(lines), 2):
        try:
            code = int(lines[i])
        except ValueError:
            continue
        pairs.append((code, lines[i + 1]))
    return pairs


def parse_dxf(text: str) -> RawDxfDocument:
    """
    Parse ASCII DXF text into a RawDxfDocument: a flat list of entities
    found in the ENTITIES section, plus $INSUNITS from the HEADER section
    if present.
    """
    pairs = _read_group_code_pairs(text)
    if not pairs:
        raise DxfParseError("No parseable content — file is empty or not ASCII DXF group-code format.")

    warnings: list[ParseWarning] = []
    insunits = 4

    # ── Locate HEADER section for $INSUNITS (best effort) ──────────────────
    in_header = False
    i = 0
    while i < len(pairs):
        code, val = pairs[i]
        if code == 0 and val == "SECTION" and i + 1 < len(pairs) and pairs[i + 1] == (2, "HEADER"):
            in_header = True
        elif code == 0 and val == "ENDSEC":
            in_header = False
        elif in_header and code == 9 and val == "$INSUNITS":
            if i + 1 < len(pairs) and pairs[i + 1][0] == 70:
                try:
                    insunits = int(pairs[i + 1][1])
                except ValueError:
                    pass
        i += 1

    # ── Locate ENTITIES section and split into per-entity code groups ─────
    entities: list[RawEntity] = []
    in_entities = False
    current: Optional[RawEntity] = None
    i = 0
    while i < len(pairs):
        code, val = pairs[i]
        if code == 0 and val == "SECTION" and i + 1 < len(pairs) and pairs[i + 1] == (2, "ENTITIES"):
            in_entities = True
            i += 2
            continue
        if in_entities and code == 0 and val == "ENDSEC":
            if current is not None:
                entities.append(current)
                current = None
            in_entities = False
            i += 1
            continue
        if in_entities and code == 0:
            if current is not None:
                entities.append(current)
            current = RawEntity(dxftype=val, codes=[])
            i += 1
            continue
        if in_entities and current is not None:
            current.codes.append((code, val))
        i += 1

    if not entities:
        warnings.append(ParseWarning(
            code="no_entities_found",
            message="No entities found in ENTITIES section — check the file contains an ENTITIES "
                    "section and is ASCII (not binary) DXF.",
            severity="warning",
        ))

    for e in entities:
        if e.dxftype == "LWPOLYLINE":
            has_bulge = any(c == 42 for c, _ in e.codes)
            if has_bulge:
                warnings.append(ParseWarning(
                    code="arc_segment_unsupported",
                    message=f"LWPOLYLINE (handle {e.get(5, '?')}) has bulge (arc) segments — "
                            "rendered as straight lines in this MVP parser.",
                    severity="info",
                    related_entity_handle=e.get(5),
                ))
        if e.dxftype == "POLYLINE":
            warnings.append(ParseWarning(
                code="legacy_polyline_unsupported",
                message=f"Legacy POLYLINE entity (handle {e.get(5, '?')}) is not supported in this "
                        "MVP parser — use LWPOLYLINE, or upgrade to ezdxf for full support.",
                severity="warning",
                related_entity_handle=e.get(5),
            ))

    return RawDxfDocument(entities=entities, insunits=insunits, warnings=warnings)


# ── Typed extraction helpers ────────────────────────────────────────────

def lwpolyline_vertices(e: RawEntity) -> list[tuple[float, float]]:
    """
    LWPOLYLINE vertices: code 10 (x) and 20 (y) repeat once per vertex, in
    order. We pair them up positionally rather than assuming interleaving,
    since some writers emit all-x-then-all-y in rare cases — pairing by
    occurrence index is the robust approach for the common case (interleaved
    10/20 per vertex) which is what virtually all real-world DXF writers do.
    """
    xs = e.get_all(10)
    ys = e.get_all(20)
    n = min(len(xs), len(ys))
    verts = []
    for i in range(n):
        try:
            verts.append((float(xs[i]), float(ys[i])))
        except ValueError:
            continue
    return verts


def lwpolyline_is_closed(e: RawEntity) -> bool:
    flag = e.get_int(70, 0)
    return bool(flag & 1)


def line_endpoints(e: RawEntity) -> tuple[tuple[float, float], tuple[float, float]]:
    return (
        (e.get_float(10), e.get_float(20)),
        (e.get_float(11), e.get_float(21)),
    )


def insert_transform(e: RawEntity) -> dict:
    return {
        "block_name": e.get(2, "UNKNOWN"),
        "x": e.get_float(10),
        "y": e.get_float(20),
        "x_scale": e.get_float(41, 1.0),
        "y_scale": e.get_float(42, 1.0),
        "rotation_deg": e.get_float(50, 0.0),
    }


def text_value(e: RawEntity) -> str:
    # MTEXT stores its content across repeated code-1/3 fragments;
    # TEXT stores it as a single code-1 value.
    if e.dxftype == "MTEXT":
        parts = e.get_all(3) + e.get_all(1)
        return "".join(parts).replace("\\P", " ").strip()
    return (e.get(1) or "").strip()
