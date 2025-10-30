"""Smoke tests for FastAPI endpoints."""

from __future__ import annotations

from pathlib import Path
import sys

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.routers import meta_router  # pylint: disable=wrong-import-position


def test_health_endpoint_returns_ok(api_client: TestClient) -> None:
    response = api_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_meta_router_exposes_health_route() -> None:
    assert any(route.path == "/health" for route in meta_router.routes)
