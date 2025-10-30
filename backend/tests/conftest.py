"""Shared pytest fixtures for backend tests."""

from __future__ import annotations

import os
from pathlib import Path

import sys

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT.parent
for path in (ROOT, WORKSPACE_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.dependencies import get_mongo_database, get_moxfield_client  # noqa: E402
from app.main import create_app  # noqa: E402
from backend.tests.utils import StubDatabase, StubMoxfieldClient


def pytest_addoption(parser: pytest.Parser) -> None:
    """Register custom CLI flags for backend test suite."""
    parser.addoption(
        "--prod-smoke",
        action="store_true",
        default=False,
        help=(
            "Run tests marked with @pytest.mark.prod against production infrastructure. "
            "Also enabled when RUN_PROD_SMOKE is set to a truthy value."
        ),
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip production smoke tests unless explicitly enabled."""
    if config.getoption("--prod-smoke"):
        return
    env_flag = os.getenv("RUN_PROD_SMOKE", "").strip()
    if env_flag.lower() in {"1", "true", "yes", "on"}:
        return
    skip_prod = pytest.mark.skip(reason="Production smoke tests disabled; pass --prod-smoke to enable.")
    for item in items:
        if "prod" in item.keywords:
            item.add_marker(skip_prod)


@pytest.fixture()
def api_client() -> TestClient:
    """Provide a FastAPI TestClient with dependency overrides reset after use."""
    app = create_app()
    stub_db = StubDatabase()
    app.dependency_overrides[get_mongo_database] = lambda: stub_db
    app.dependency_overrides[get_moxfield_client] = lambda: StubMoxfieldClient()
    app.state.stub_db = stub_db
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()
