"""
app/core/logging.py

Central logging setup. Called once at application startup
(`configure_logging()` in `app.main.create_app`). Two output formats:

- "text": human-readable, for local development (`LOG_FORMAT=text`, default)
- "json": one JSON object per line, for production log aggregation
  (`LOG_FORMAT=json`)

Every module in this service gets its logger via
`logging.getLogger(__name__)` as usual — this file only configures the
root logger's handlers/formatters/level, it does not wrap or replace the
standard library logging calls anywhere else.
"""

from __future__ import annotations

import json
import logging
import logging.config
from datetime import datetime, timezone
from typing import Any

from app.config.settings import Settings


class JsonFormatter(logging.Formatter):
    """Renders one JSON object per log record — timestamp, level, logger
    name, message, and (if present) exception info."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(settings: Settings) -> None:
    """Configures the root logger's level and formatter based on settings.
    Idempotent — safe to call multiple times (e.g. once per test)."""
    formatter_name = "json" if settings.log_format.lower() == "json" else "text"

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "text": {
                    "format": "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
                    "datefmt": "%Y-%m-%dT%H:%M:%S%z",
                },
                "json": {"()": JsonFormatter},
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": formatter_name,
                    "stream": "ext://sys.stdout",
                }
            },
            "root": {
                "level": settings.log_level.upper(),
                "handlers": ["console"],
            },
            "loggers": {
                # Keep uvicorn's own access/error logs at the same level,
                # routed through the same handler, instead of uvicorn's
                # default separate formatting.
                "uvicorn": {"level": settings.log_level.upper(), "handlers": ["console"], "propagate": False},
                "uvicorn.error": {"level": settings.log_level.upper(), "handlers": ["console"], "propagate": False},
                "uvicorn.access": {"level": settings.log_level.upper(), "handlers": ["console"], "propagate": False},
            },
        }
    )
