"""tests/test_info.py"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config.settings import get_settings


def test_info_returns_200(client: TestClient) -> None:
    res = client.get("/api/v1/info")
    assert res.status_code == 200


def test_info_matches_configured_settings(client: TestClient) -> None:
    settings = get_settings()
    body = client.get("/api/v1/info").json()
    assert body["name"] == settings.app_name
    assert body["version"] == settings.app_version
    assert body["environment"] == settings.environment


def test_info_includes_api_version(client: TestClient) -> None:
    body = client.get("/api/v1/info").json()
    assert body["apiVersion"] == "v1"
