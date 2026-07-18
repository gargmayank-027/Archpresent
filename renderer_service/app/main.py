"""
app/main.py

Application entrypoint. `create_app()` is a factory (not a bare module-
level `FastAPI()` call) so tests can construct fresh app instances with
overridden settings if ever needed; `app = create_app()` below is what
`uvicorn app.main:app` actually serves.

Startup order matters here: logging must be configured before anything
else runs (so even startup-time log lines are formatted correctly), and
exception handlers must be registered before the app can serve any
request.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_v1_router
from app.config.settings import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging

logger = logging.getLogger(__name__)


def _make_lifespan(settings: Settings):
    """Returns a lifespan context manager bound to `settings`, so startup/
    shutdown logging reflects the exact settings this app instance was
    built with (relevant mainly for tests, which may construct multiple
    app instances)."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "%s v%s starting up (environment=%s, log_format=%s)",
            settings.app_name, settings.app_version, settings.environment, settings.log_format,
        )
        yield
        logger.info("%s shutting down", settings.app_name)

    return lifespan


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings)

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Deterministic CAD-to-floor-plan rendering service for ArchPresent.",
        lifespan=_make_lifespan(settings),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    app.include_router(api_v1_router)

    return app


app = create_app()
