"""tests/test_health.py"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_returns_200(client: TestClient) -> None:
    res = client.get("/api/v1/health")
    assert res.status_code == 200


def test_health_status_is_ok(client: TestClient) -> None:
    res = client.get("/api/v1/health")
    body = res.json()
    assert body["status"] == "ok"


def test_health_includes_version_and_environment(client: TestClient) -> None:
    res = client.get("/api/v1/health")
    body = res.json()
    assert "version" in body
    assert "environment" in body
