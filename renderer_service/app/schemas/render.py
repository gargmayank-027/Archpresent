"""
app/schemas/render.py

Response schema for POST /api/v1/render. Sprint 2 replaces the Sprint
1-era placeholder shape (`status: "not_implemented"`) with the real
one — this is exactly the change that schema's own docstring said would
happen here. Matches cad-service-fastapi-migration-plan.md §3.3.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class WarningSchema(BaseModel):
    code: str
    message: str
    severity: str


class RoomBoundingBoxSchema(BaseModel):
    x: float
    y: float
    width: float
    height: float


class RoomSchema(BaseModel):
    name: str
    size_estimate_sqm: float | None = Field(default=None, alias="sizeEstimateSqm")
    bounding_box: RoomBoundingBoxSchema = Field(alias="boundingBox")
    room_type: str = Field(alias="roomType")
    classification_confidence: float = Field(alias="classificationConfidence")

    model_config = {"populate_by_name": True}


class RenderResponse(BaseModel):
    """The real render response — a colored, themed SVG floor plan plus
    the structured room/warning data the ArchPresent Next.js app's
    RoomDetail contract expects (see archpresent-cad-migration-plan.md)."""

    ok: bool = True
    svg: str
    ir: dict = Field(description="The full FloorPlanIR, as a plain dict (pydantic .model_dump()).")
    rooms: list[RoomSchema]
    warnings: list[WarningSchema]
    theme: str
    room_count: int = Field(alias="roomCount")
    furniture_count: int = Field(alias="furnitureCount")
    wall_count: int = Field(alias="wallCount")
    unmapped_block_names: list[str] = Field(
        default_factory=list, alias="unmappedBlockNames",
        description="Distinct furniture block names that didn't match any known pattern "
                    "(mapping_stage=3) and were rendered with the generic placeholder symbol. "
                    "Feed these back as keys in block_overrides on a future request to fix them.",
    )

    model_config = {"populate_by_name": True}
