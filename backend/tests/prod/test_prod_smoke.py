"""Production-only smoke tests for deployed infrastructure."""

from __future__ import annotations

import os

import httpx
import pytest
from motor.motor_asyncio import AsyncIOMotorClient


@pytest.fixture()
def anyio_backend() -> str:
    """Force prod anyio tests to use asyncio backend only."""
    return "asyncio"


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        pytest.skip(f"Environment variable '{name}' not provided for production smoke tests.")
    return value


@pytest.mark.prod
def test_frontend_serves_index() -> None:
    """Smoke-test the static frontend served by Nginx."""
    base_url = _require_env("PROD_FRONTEND_BASE_URL").rstrip("/")
    with httpx.Client(timeout=5.0) as client:
        response = client.get(f"{base_url}/")
    assert response.status_code == 200
    content = response.text.strip()
    assert content, "Frontend returned empty response."


@pytest.mark.prod
def test_api_healthcheck_is_healthy() -> None:
    """Verify the FastAPI `/health` endpoint is reachable in production."""
    api_base = _require_env("PROD_API_BASE_URL").rstrip("/")
    with httpx.Client(timeout=5.0) as client:
        response = client.get(f"{api_base}/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("status") == "ok"


@pytest.mark.prod
@pytest.mark.anyio
async def test_mongo_ping_succeeds() -> None:
    """Ensure the production MongoDB cluster is reachable and responsive."""
    mongo_uri = _require_env("PROD_MONGO_URI")
    client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=3000)
    try:
        result = await client.admin.command("ping")
    finally:
        client.close()
    assert result.get("ok") == 1.0
