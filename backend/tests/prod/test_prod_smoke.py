"""Production-only smoke tests for deployed infrastructure."""

from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest
from motor.motor_asyncio import AsyncIOMotorClient


def _parse_env_file(path: Path) -> dict[str, str]:
    """Return environment variables parsed from a `.env` style file."""
    variables: dict[str, str] = {}
    try:
        content = path.read_text(encoding="utf8")
    except OSError:
        return variables
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export ") :].strip()
        if not key:
            continue
        value = value.strip()
        if value and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        else:
            hash_index = value.find(" #")
            if hash_index != -1:
                value = value[:hash_index].strip()
        variables[key] = value
    return variables


def _bootstrap_env_from_files() -> None:
    """Populate `os.environ` with prod credentials from repo-local env files."""
    repo_root = Path(__file__).resolve().parents[3]
    env_root = Path(os.getenv("EDH_PODLOG_ENV_ROOT", repo_root))
    # Allow overrides via the same knobs as the frontend config generator.
    configured = []
    for var in ("EDH_PODLOG_PROD_ENV_FILES", "EDH_PODLOG_ENV_FILES"):
        raw = os.getenv(var)
        if raw:
            configured.extend(filter(None, raw.split(":")))

    default_candidates = [
        ".env",
        ".env.local",
        ".env.prod",
        ".env.production",
    ]
    test_local = Path(__file__).with_name(".env")

    seen: set[Path] = set()
    def _resolve(candidate: str) -> Path:
        path = Path(candidate)
        if not path.is_absolute():
            path = env_root / candidate
        return path

    for candidate in configured + default_candidates:
        path = _resolve(candidate)
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        for key, value in _parse_env_file(path).items():
            os.environ.setdefault(key, value)

    if test_local.is_file() and test_local not in seen:
        seen.add(test_local)
        for key, value in _parse_env_file(test_local).items():
            os.environ.setdefault(key, value)


_bootstrap_env_from_files()


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
