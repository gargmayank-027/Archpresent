"""
app/core/exceptions.py

A small exception hierarchy plus `register_exception_handlers(app)`,
which maps every exception this service can raise — custom or from
FastAPI/Starlette/Pydantic itself — to ONE consistent JSON error
envelope:

    { "ok": false, "error": { "code": "...", "message": "..." } }

This is the exact shape specced in `cad-service-fastapi-migration-plan.md`
§3.6, so `lib/cadClient.ts` on the Next.js side only ever has one error
shape to parse, regardless of which layer raised the error.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppException(Exception):
    """Base class for all deliberately-raised application errors.

    Subclasses set `code` (a short, stable machine-readable string) and
    `status_code` (the HTTP status to respond with); `message` is passed
    per-instance since it's request-specific.
    """

    code: str = "app_error"
    status_code: int = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class ValidationException(AppException):
    """Raised for request-content validation failures this service checks
    itself (e.g. wrong file extension) — distinct from FastAPI's own
    schema-level `RequestValidationError`, which is handled separately
    below but produces the same envelope shape."""

    code = "invalid_request"
    status_code = status.HTTP_400_BAD_REQUEST


class PayloadTooLargeException(AppException):
    code = "file_too_large"
    # Plain int, not `status.HTTP_413_...` — Starlette renamed that
    # constant (REQUEST_ENTITY_TOO_LARGE -> CONTENT_TOO_LARGE) and a
    # symbolic name here would just be pinned to whichever spelling
    # happens to exist in the installed Starlette version. 413 is a
    # stable HTTP status code regardless of what either library calls it.
    status_code = 413


class DxfParseException(AppException):
    """The uploaded file passed request-level validation (right extension,
    non-empty, within size limits) but the DXF parser itself couldn't
    read it — corrupt file, unsupported DXF variant, empty ENTITIES
    section, etc. Distinct from ValidationException because the failure
    is in file *content*, not in the HTTP request shape."""

    code = "dxf_parse_error"
    status_code = 422


class RenderException(AppException):
    """The DXF parsed successfully but rendering (IR build or SVG
    generation) failed unexpectedly. Kept distinct from
    DxfParseException so client-side error messages can be specific
    about which stage failed."""

    code = "render_error"
    status_code = 422


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"ok": False, "error": {"code": code, "message": message}},
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Registers every exception handler this service needs. Called once
    from `app.main.create_app()`."""

    @app.exception_handler(AppException)
    async def handle_app_exception(request: Request, exc: AppException) -> JSONResponse:
        logger.info("Handled application exception: %s (%s)", exc.code, exc.message)
        return _error_response(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic/FastAPI's own schema validation (missing required
        # fields, wrong types) — normalized into the same envelope rather
        # than FastAPI's default {"detail": [...]} shape.
        first_error = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(loc) for loc in first_error.get("loc", []))
        message = f"Invalid request: {first_error.get('msg', 'validation failed')} ({field})" if field else "Invalid request."
        logger.info("Request validation failed: %s", exc.errors())
        return _error_response(422, "invalid_request", message)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Catches FastAPI's own HTTPException (e.g. 404 for unknown
        # routes) so even those get the consistent envelope.
        logger.info("HTTP exception: %s %s", exc.status_code, exc.detail)
        return _error_response(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(request: Request, exc: Exception) -> JSONResponse:
        # Last resort: anything not caught above. Log the full traceback
        # server-side with a request ID for correlation; never leak
        # internal details (stack traces, exception text) to the client.
        request_id = str(uuid.uuid4())
        logger.exception("Unhandled exception [request_id=%s]", request_id)
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "internal_error",
            f"An unexpected error occurred. Reference: {request_id}",
        )
