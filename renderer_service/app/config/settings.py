"""
app/config/settings.py

Central application configuration, loaded from environment variables
(and, in local dev, a `.env` file) via `pydantic-settings`. Every other
module reads configuration through `get_settings()` — nothing reads
`os.environ` directly outside this file, so there is exactly one place
that defines what's configurable and what its defaults are.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Runtime configuration for the renderer service.

    Every field has a safe, working default for local development, so the
    service runs with zero configuration out of the box (`uvicorn
    app.main:app`) — production deployments override via real env vars.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application identity ────────────────────────────────────────────
    app_name: str = "ArchPresent Renderer Service"
    app_version: str = "0.1.0"
    environment: str = "development"  # "development" | "staging" | "production"
    debug: bool = False

    # ── Logging ──────────────────────────────────────────────────────────
    log_level: str = "INFO"
    log_format: str = "text"  # "text" (human-readable, local dev) | "json" (structured, prod)

    # ── Server ───────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000

    # ── CORS ─────────────────────────────────────────────────────────────
    # Deliberately typed as a plain `str`, NOT `list[str]`. pydantic-settings
    # treats list/dict-typed env fields as "complex" and tries to JSON-decode
    # the raw env value BEFORE any field_validator runs — so a plain
    # comma-separated string (the natural .env format) fails with a
    # SettingsError before our own parsing ever gets a chance. Keeping this
    # a `str` sidesteps that entirely; `cors_allow_origins_list` below does
    # the comma-splitting on demand.
    cors_allow_origins: str = "http://localhost:3000"

    # ── Request limits (enforced by the /render endpoint's validation
    #    layer in Sprint 1 — no file is actually processed yet, but the
    #    limits are real and tested) ────────────────────────────────────
    max_upload_size_mb: int = 20
    request_timeout_seconds: int = 30

    @property
    def cors_allow_origins_list(self) -> list[str]:
        """Comma-separated CORS_ALLOW_ORIGINS, split into a list.
        e.g. "http://localhost:3000,https://app.example.com" -> both origins."""
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor — Settings() is only ever constructed once
    per process. Use `get_settings.cache_clear()` in tests that need to
    override environment variables mid-run."""
    return Settings()
