"""app/api/v1/endpoints/health.py"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from app.config.settings import Settings, get_settings
from app.schemas.health import HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness/readiness probe",
    description=(
        "Returns 200 with a static payload whenever the process is up and "
        "able to respond. Deliberately does not check any external "
        "dependency — this service currently has none, and a probe that "
        "starts failing when an unrelated dependency degrades is worse "
        "than one that always reflects true liveness. Used by Docker's "
        "HEALTHCHECK and by the Next.js bridge to fail fast with a clear "
        "error instead of a raw connection timeout."
    ),
)
async def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(status="ok", version=settings.app_version, environment=settings.environment)
