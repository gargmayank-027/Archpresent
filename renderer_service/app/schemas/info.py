"""app/schemas/info.py"""

from __future__ import annotations

from pydantic import BaseModel, Field


class InfoResponse(BaseModel):
    """General service metadata — useful for the Next.js side (and humans)
    to confirm which build/environment they're talking to."""

    name: str
    version: str
    environment: str
    description: str = Field(
        default="ArchPresent deterministic CAD-to-floor-plan rendering service."
    )
    api_version: str = Field(default="v1", alias="apiVersion")

    model_config = {"populate_by_name": True}
