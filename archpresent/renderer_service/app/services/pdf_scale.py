"""
app/services/pdf_scale.py

PDF page-point -> real-world-millimetre conversion, with an optional
manual drafting-scale override. This is the PDF engine's analogue of
`units.py`, but solving a different problem: `units.py` answers "what
does 1 raw DXF coordinate unit mean" from a header ($INSUNITS) that
might be lying; this module answers a question a PDF page has NO header
for at all — "what real-world distance does 1mm on the printed page
represent" (the drafting/plot scale, e.g. "1:100").

Without an override, there is no way to recover this honestly — unlike
DXF, a PDF page carries no drafting-scale metadata whatsoever. Rather
than guess, this defaults to 1:1 (the page's physical print size is
treated as the real-world size) and adds an explicit, visible warning —
the same "honest, visible fallback instead of a silent wrong guess"
choice `units.py` makes for an unrecognized/unitless $INSUNITS value.
"""

from __future__ import annotations

import logging
import re

from app.models.floorplan import ParseWarning

logger = logging.getLogger(__name__)

# 1 PDF point = 1/72 inch = 25.4/72 mm — a physical, unambiguous constant
# (this is what "point" means in the PDF spec), giving the PRINTED page's
# physical size. It does not by itself give real-world building size.
PT_TO_MM = 25.4 / 72.0

_SCALE_RATIO_RE = re.compile(r"^\s*1\s*:\s*(\d+(?:\.\d+)?)\s*$")


def parse_scale_override(scale_override: str) -> float | None:
    """Parses a "1:N" drafting-scale string (e.g. "1:50", "1:100") into
    the real-world-mm-per-page-mm multiplier N. Returns None if the
    string doesn't match that shape."""
    m = _SCALE_RATIO_RE.match(scale_override)
    if not m:
        return None
    try:
        n = float(m.group(1))
    except ValueError:
        return None
    return n if n > 0 else None


def scale_factor_mm_per_pt(
    scale_override: str | None,
    warnings: list[ParseWarning],
) -> float:
    """
    Returns the multiplier to convert raw PDF page-point coordinates
    directly to real-world millimetres.

    `scale_override`, when given, must be a drafting-scale ratio "1:N"
    (e.g. "1:100" means 1mm on the printed page represents 100mm / 10cm
    in the real world) — takes precedence entirely, exactly as
    `units.py`'s `unit_override` takes precedence over a DXF's own
    $INSUNITS. An info-level warning records that an override was
    applied, so it's visible in the response, not silently swallowed.

    Without an override, this cannot safely guess the drafting scale (no
    header exists to even be wrong about) — falls back to 1:1 (the page's
    physical print size is treated as real-world size) with an explicit
    warning, matching units.py's $INSUNITS=0 "unitless" fallback.
    """
    if scale_override:
        ratio = parse_scale_override(scale_override)
        if ratio is None:
            logger.warning("Unrecognized scale_override '%s' — ignoring it, assuming 1:1.", scale_override)
            warnings.append(ParseWarning(
                code="invalid_scale_override",
                message=f"Unrecognized scale override '{scale_override}' (expected format '1:N', "
                        f"e.g. '1:100') — ignored, assuming the plan is plotted at 1:1.",
                severity="warning",
            ))
        else:
            logger.info("Applying manual PDF scale override: 1:%s (%.4f mm/pt).", ratio, PT_TO_MM * ratio)
            warnings.append(ParseWarning(
                code="scale_override_applied",
                message=f"Manual drafting-scale override applied: treating the plan as plotted at "
                        f"1:{ratio:g} — 1mm on the page represents {ratio:g}mm in the real world.",
                severity="info",
            ))
            return PT_TO_MM * ratio

    logger.warning("No scale_override given for a PDF plan — assuming the plan is plotted at 1:1.")
    warnings.append(ParseWarning(
        code="unknown_pdf_scale",
        message="No drafting scale was given for this PDF — dimensions are being computed "
                "assuming the plan is plotted at 1:1 (1mm on the page = 1mm in reality), which "
                "is almost certainly wrong for a real architectural drawing. Pass scale_override "
                "as '1:N' (e.g. '1:100') matching the plan's title-block scale for correct sizes.",
        severity="warning",
    ))
    return PT_TO_MM
