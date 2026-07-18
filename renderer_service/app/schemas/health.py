"""app/schemas/health.py"""

from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Liveness/readiness probe response. Deliberately minimal — see
    endpoint docstring for why this stays a trivial "is the process
    alive" check rather than a deep dependency check."""

    status: str = Field(default="ok", examples=["ok"])
    version: str = Field(examples=["0.1.0"])
    environment: str = Field(examples=["development"])
