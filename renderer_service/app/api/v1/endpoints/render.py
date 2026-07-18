"""
app/api/v1/endpoints/render.py

Validation logic (file present, correct extension, non-empty, within
the configured size limit) is unchanged since Sprint 1. Now also
accepts `unit_override` (Sprint: unit-scale correction) and
`block_overrides` (Sprint: per-project furniture block-name mapping) —
both were already supported by the underlying pipeline
(app.services.render_pipeline) but not previously exposed over HTTP.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Form, UploadFile, File

from app.config.settings import Settings, get_settings
from app.core.exceptions import (
    DxfParseException, PayloadTooLargeException, RenderException, ValidationException,
)
from app.models.floorplan import FurnitureCategory
from app.schemas.render import RenderResponse
from app.services.dxf_parser import DxfParseError
from app.services.units import UNIT_OVERRIDE_TO_MM
from app.services import render_pipeline

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_EXTENSIONS = (".dxf",)
VALID_FURNITURE_CATEGORIES = {c.value for c in FurnitureCategory}


def _validate_upload(file: UploadFile, size_bytes: int, settings: Settings) -> None:
    """Raises ValidationException / PayloadTooLargeException on failure;
    returns normally if the upload is acceptable. Pulled out as its own
    function so it's directly unit-testable independent of the endpoint
    plumbing."""
    filename = file.filename or ""
    if not filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise ValidationException(
            f"Unsupported file type. Expected one of {ALLOWED_EXTENSIONS}, got '{filename}'."
        )
    if size_bytes == 0:
        raise ValidationException("Uploaded file is empty.")
    if size_bytes > settings.max_upload_size_bytes:
        raise PayloadTooLargeException(
            f"File is {size_bytes / (1024 * 1024):.1f} MB, which exceeds the "
            f"{settings.max_upload_size_mb} MB limit."
        )


def _parse_block_overrides(raw: str | None) -> dict[str, FurnitureCategory] | None:
    """Parses the block_overrides form field: a JSON object mapping raw
    CAD block names to a FurnitureCategory value, e.g.
    `{"RGHRHT": "sofa", "A$C0D2919B9": "dining_table"}`. Raises
    ValidationException with a specific, actionable message on any
    malformed input — this is a form field a person fills in by hand
    (or a UI submits on their behalf), so validation errors need to be
    clear about exactly what's wrong."""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValidationException(f"block_overrides is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValidationException("block_overrides must be a JSON object mapping block name -> category.")

    result: dict[str, FurnitureCategory] = {}
    for block_name, category_str in parsed.items():
        if not isinstance(category_str, str) or category_str not in VALID_FURNITURE_CATEGORIES:
            raise ValidationException(
                f"block_overrides['{block_name}'] = '{category_str}' is not a valid furniture "
                f"category. Expected one of: {sorted(VALID_FURNITURE_CATEGORIES)}."
            )
        result[block_name] = FurnitureCategory(category_str)
    return result


def _unmapped_block_names(ir) -> list[str]:
    """Distinct block names that fell back to the generic symbol
    (mapping_stage == 3) — surfaced so a caller can build a UI offering
    to map them via block_overrides on a future request."""
    seen: list[str] = []
    for item in ir.furniture:
        if item.mapping_stage == 3 and item.block_name not in seen:
            seen.append(item.block_name)
    return seen


@router.post(
    "/render",
    response_model=RenderResponse,
    summary="Render a floor plan",
    description=(
        "Accepts a DXF file and a theme selection, parses it deterministically, "
        "and returns a themed SVG floor plan plus structured room/warning data. "
        "Geometry is never redesigned — walls, rooms, and furniture are drawn "
        "exactly as they appear in the source file."
    ),
)
async def render(
    file: UploadFile = File(..., description="The CAD file to render (.dxf)"),
    theme: str = Form(default="modern", description="Theme key to render with"),
    unit_override: str | None = Form(
        default=None,
        description=(
            "Optional: override the file's declared $INSUNITS. One of "
            f"{sorted(UNIT_OVERRIDE_TO_MM)}. Use when a file's actual drawing "
            "units don't match its header (a real, observed failure mode — "
            "see app/services/units.py)."
        ),
    ),
    block_overrides: str | None = Form(
        default=None,
        description=(
            "Optional: JSON object mapping raw CAD block names to a furniture "
            "category, e.g. {\"RGHRHT\": \"sofa\"}. Use the `unmappedBlockNames` "
            "field from a prior response to build this. Valid categories: "
            f"{sorted(VALID_FURNITURE_CATEGORIES)}."
        ),
    ),
    settings: Settings = Depends(get_settings),
) -> RenderResponse:
    contents = await file.read()
    size_bytes = len(contents)

    _validate_upload(file, size_bytes, settings)

    if unit_override and unit_override.strip().lower() not in UNIT_OVERRIDE_TO_MM:
        raise ValidationException(
            f"Invalid unit_override '{unit_override}'. Expected one of: {sorted(UNIT_OVERRIDE_TO_MM)}."
        )

    parsed_block_overrides = _parse_block_overrides(block_overrides)

    filename = file.filename or "unknown.dxf"
    logger.info(
        "Render request accepted: filename=%s size_bytes=%d theme=%s unit_override=%s block_overrides=%d",
        filename, size_bytes, theme, unit_override, len(parsed_block_overrides or {}),
    )

    try:
        dxf_text = contents.decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001 — any decode failure is a content problem, not a bug
        raise DxfParseException(f"Could not decode file as text: {exc}") from exc

    try:
        result = render_pipeline.run(
            dxf_text, filename, theme_key=theme,
            unit_override=unit_override, block_overrides=parsed_block_overrides,
        )
    except DxfParseError as exc:
        logger.info("DXF parse failed for %s: %s", filename, exc)
        raise DxfParseException(str(exc)) from exc
    except DxfParseException:
        raise
    except Exception as exc:  # noqa: BLE001 — anything else from the pipeline is a render-stage failure
        logger.exception("Unexpected render pipeline failure for %s", filename)
        raise RenderException(f"Rendering failed: {exc}") from exc

    return RenderResponse(
        svg=result.svg,
        ir=result.ir.model_dump(mode="json"),
        rooms=[
            {
                "name": r.name,
                "sizeEstimateSqm": r.size_estimate_sqm,
                "boundingBox": r.bounding_box,
                "roomType": r.room_type,
                "classificationConfidence": r.classification_confidence,
            }
            for r in result.rooms
        ],
        warnings=result.warnings,
        theme=result.theme_key,
        roomCount=len(result.ir.rooms),
        furnitureCount=len(result.ir.furniture),
        wallCount=len(result.ir.walls),
        unmappedBlockNames=_unmapped_block_names(result.ir),
    )
