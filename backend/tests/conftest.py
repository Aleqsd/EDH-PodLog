"""Shared pytest fixtures for backend tests."""

from __future__ import annotations

from pathlib import Path

import sys

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.dependencies import get_mongo_database, get_moxfield_client  # noqa: E402
from app.main import create_app  # noqa: E402
from backend.tests.utils import StubDatabase, StubMoxfieldClient


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
