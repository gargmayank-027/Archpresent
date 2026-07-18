"""
app/services/units.py

DXF $INSUNITS -> millimetre normalization, with an optional manual
override.

Why the override exists: a real production file was found where
$INSUNITS declared millimeters, but the actual coordinate data was
authored in inches — confirmed to two decimal places (a room's computed
area was off from its own text label by a factor of exactly 645.2,
which is 25.4 squared, the mm-per-inch conversion). This is a real,
observed authoring mistake (mismatched template/header vs. what the
drafter actually worked in), not a hypothetical — and it's inherently
undetectable from the header alone, since the header is exactly what's
wrong. The override lets the person uploading the file — who can look
at a known room dimension and recognize the mismatch — correct it
explicitly, rather than the parser silently trusting a header that may
be lying.
"""

from __future__ import annotations

import logging

from app.models.floorplan import ParseWarning

logger = logging.getLogger(__name__)

_INSUNITS_TO_MM: dict[int, float] = {
    0: 1.0,     # unitless — assume mm, warn
    1: 25.4,    # inches
    2: 304.8,   # feet
    4: 1.0,     # millimeters
    5: 10.0,    # centimeters
    6: 1000.0,  # meters
}

# Manual override keys accepted from the API/CLI — a small, explicit set
# rather than accepting arbitrary DXF $INSUNITS integers, since the whole
# point is for a human to pick the unit they recognize their file was
# actually drawn in.
UNIT_OVERRIDE_TO_MM: dict[str, float] = {
    "mm": 1.0,
    "cm": 10.0,
    "m": 1000.0,
    "in": 25.4,
    "ft": 304.8,
}


def units_factor(
    insunits: int,
    warnings: list[ParseWarning],
    unit_override: str | None = None,
) -> float:
    """
    Returns the multiplier to convert raw DXF coordinates to millimetres.

    If `unit_override` is given (one of UNIT_OVERRIDE_TO_MM's keys), it
    takes precedence over the file's own $INSUNITS header entirely — the
    header is not even consulted, since the override exists specifically
    for the case where the header is wrong. An info-level warning is
    still added so it's visible in the response that an override was
    applied, not silently swallowed.

    Without an override, behavior is unchanged from before: read
    $INSUNITS, warn on unrecognized/unitless values, default to mm.
    """
    if unit_override:
        key = unit_override.strip().lower()
        factor = UNIT_OVERRIDE_TO_MM.get(key)
        if factor is None:
            valid = ", ".join(sorted(UNIT_OVERRIDE_TO_MM))
            logger.warning("Unrecognized unit_override '%s' — ignoring it, using $INSUNITS instead.", unit_override)
            warnings.append(ParseWarning(
                code="invalid_unit_override",
                message=f"Unrecognized unit override '{unit_override}' (expected one of: {valid}) "
                        f"— ignored, using the file's $INSUNITS instead.",
                severity="warning",
            ))
        else:
            logger.info("Applying manual unit override: %s (factor=%.2f mm/unit).", key, factor)
            warnings.append(ParseWarning(
                code="unit_override_applied",
                message=f"Manual unit override applied: treating drawing units as '{key}' "
                        f"({factor} mm per unit), ignoring the file's declared $INSUNITS.",
                severity="info",
            ))
            return factor

    factor = _INSUNITS_TO_MM.get(insunits)
    if factor is None:
        logger.warning("Unrecognized $INSUNITS value %s — assuming millimeters.", insunits)
        warnings.append(ParseWarning(
            code="unrecognized_insunits",
            message=f"Unrecognized $INSUNITS value {insunits} — assuming millimeters.",
            severity="warning",
        ))
        return 1.0
    if insunits == 0:
        logger.info("Drawing has no declared units ($INSUNITS=0) — assuming millimeters.")
        warnings.append(ParseWarning(
            code="unitless_insunits",
            message="Drawing has no declared units ($INSUNITS=0) — assuming millimeters.",
            severity="warning",
        ))
    return factor
