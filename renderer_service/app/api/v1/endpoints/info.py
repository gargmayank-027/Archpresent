"""app/api/v1/endpoints/info.py"""

from __future__ import annotations

import logging
import sys

from fastapi import APIRouter, Depends

from app.config.settings import Settings, get_settings
from app.schemas.info import InfoResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get(
    "/info",
    response_model=InfoResponse,
    summary="Service metadata",
    description="Returns the service's name, version, and running environment.",
)
async def info(settings: Settings = Depends(get_settings)) -> InfoResponse:
    logger.debug("Info requested (python=%s)", sys.version.split()[0])
    return InfoResponse(
        name=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
    )
