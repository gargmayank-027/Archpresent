"""
app/api/v1/router.py

Aggregates every v1 endpoint module under a single router mounted at
/api/v1 in app.main. Adding a new endpoint module in a later sprint is:
write the module under endpoints/, import it here, include it below —
nothing else changes.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints import health, info, render

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(health.router, tags=["health"])
api_v1_router.include_router(info.router, tags=["info"])
api_v1_router.include_router(render.router, tags=["render"])
