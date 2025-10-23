"""Tests for user-facing FastAPI endpoints."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_mongo_database, get_moxfield_client
from app.main import create_app
from app.moxfield import MoxfieldError, MoxfieldNotFoundError


class _StubMoxfieldClient:
    """Simple stub that mimics the Moxfield client behaviour."""

    def __init__(
        self,
        payload: Dict[str, Any] | None = None,
        *,
        error: Exception | None = None,
        summary_payload: Dict[str, Any] | None = None,
        deck_summaries: List[Dict[str, Any]] | None = None,
    ) -> None:
        self._payload = payload
        self._error = error
        self._summary_payload = summary_payload or {}
        self._deck_summaries = list(deck_summaries or [])

    async def collect_user_decks_with_details(self, username: str, **_: Any) -> Dict[str, Any]:
        if self._error:
            raise self._error
        return self._payload or {}

    async def get_user_summary(self, username: str, **_: Any) -> Dict[str, Any]:
        if self._error:
            raise self._error
        if self._summary_payload:
            return self._summary_payload
        return {
            "userName": username,
            "displayName": username,
            "profileImageUrl": None,
            "badges": [],
        }

    async def get_user_deck_summaries(self, username: str, **_: Any) -> List[Dict[str, Any]]:
        if self._error:
            raise self._error
        return self._deck_summaries


class _StubCursor:
    """Minimal cursor wrapper to simulate Motor's async cursor."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self._documents = documents

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return deepcopy(self._documents if length is None else self._documents[:length])


class _StubCollection:
    """In-memory Motor-like collection used for API tests."""

    def __init__(self) -> None:
        self.documents: list[dict[str, Any]] = []
        self.created_indexes: list[dict[str, Any]] = []

    def _matches(self, document: dict[str, Any], filter_: dict[str, Any]) -> bool:
        for key, value in filter_.items():
            if key == "$or":
                if not any(self._matches(document, clause) for clause in value):
                    return False
            else:
                if document.get(key) != value:
                    return False
        return True

    async def update_one(
        self,
        filter_: dict[str, Any],
        update: dict[str, Any],
        *,
        upsert: bool = False,
        **_: Any,
    ):
        match = None
        for document in self.documents:
            if self._matches(document, filter_):
                match = document
                break

        matched_count = 0

        if match is not None:
            match.update(deepcopy(update.get("$set", {})))
            matched_count = 1
            return type("UpdateResult", (), {"matched_count": matched_count, "upserted_id": None})()

        if upsert:
            new_document = deepcopy(update.get("$set", {}))
            self.documents.append(new_document)
            return type("UpdateResult", (), {"matched_count": matched_count, "upserted_id": object()})()

        return type("UpdateResult", (), {"matched_count": matched_count, "upserted_id": None})()

    async def find_one(self, filter_: dict[str, Any]) -> dict[str, Any] | None:
        for document in self.documents:
            if self._matches(document, filter_):
                return deepcopy(document)
        return None

    def find(self, filter_: dict[str, Any]) -> _StubCursor:
        results = [
            deepcopy(document)
            for document in self.documents
            if self._matches(document, filter_)
        ]
        return _StubCursor(results)

    async def replace_one(
        self,
        filter_: dict[str, Any],
        replacement: dict[str, Any],
        *,
        upsert: bool = False,
        **_: Any,
    ):
        for index, document in enumerate(self.documents):
            if self._matches(document, filter_):
                self.documents[index] = deepcopy(replacement)
                return type(
                    "ReplaceResult",
                    (),
                    {"matched_count": 1, "upserted_id": None},
                )()
        if upsert:
            self.documents.append(deepcopy(replacement))
            return type(
                "ReplaceResult",
                (),
                {"matched_count": 0, "upserted_id": object()},
            )()
        return type("ReplaceResult", (), {"matched_count": 0, "upserted_id": None})()

    async def delete_one(self, filter_: dict[str, Any]):
        for index, document in enumerate(self.documents):
            if self._matches(document, filter_):
                self.documents.pop(index)
                return type("DeleteResult", (), {"deleted_count": 1})()
        return type("DeleteResult", (), {"deleted_count": 0})()

    async def count_documents(self, filter_: dict[str, Any]) -> int:
        return sum(1 for document in self.documents if self._matches(document, filter_))

    async def create_indexes(self, indexes: list[Any]):
        for raw in indexes:
            document = getattr(raw, "document", raw)
            name = document.get("name")
            key_spec = document.get("key")
            if isinstance(key_spec, dict):
                keys = tuple(key_spec.items())
            elif isinstance(key_spec, list):
                keys = tuple(tuple(item) for item in key_spec)
            else:
                keys = ()
            self.created_indexes.append({"name": name, "keys": keys})
        return [entry["name"] for entry in self.created_indexes]


class _StubDatabase:
    """Dictionary-like helper that returns stub collections."""

    def __init__(self) -> None:
        self._collections: dict[str, _StubCollection] = {}

    def __getitem__(self, name: str) -> _StubCollection:
        if name not in self._collections:
            self._collections[name] = _StubCollection()
        return self._collections[name]


@pytest.fixture()
def api_client() -> TestClient:
    """Provide a FastAPI TestClient with dependency overrides reset after use."""
    app = create_app()
    stub_db = _StubDatabase()
    app.dependency_overrides[get_mongo_database] = lambda: stub_db
    app.state.stub_db = stub_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


def test_get_user_decks_success(api_client: TestClient) -> None:
    """The endpoint should return a normalized response when the client succeeds."""
    stub_payload = {
        "user": {
            "userName": "TestUser",
            "displayName": "Test User",
            "profileImageUrl": "https://example.com/avatar.png",
            "badges": [{"name": "Badge"}],
        },
        "decks": [
            {
                "id": "deck123",
                "publicId": "deck-public",
                "name": "Sample Deck",
                "format": "commander",
                "visibility": "public",
                "description": "Example deck description.",
                "publicUrl": "https://moxfield.com/decks/deck-public",
                "createdAtUtc": "2024-01-01T00:00:00Z",
                "lastUpdatedAtUtc": "2024-01-02T00:00:00Z",
                "likeCount": 10,
                "viewCount": 20,
                "commentCount": 5,
                "bookmarkCount": 3,
                "createdByUser": {
                    "userName": "Author",
                    "displayName": "Deck Author",
                    "profileImageUrl": "https://example.com/author.png",
                },
                "authors": [
                    {
                        "userName": "Author",
                        "displayName": "Deck Author",
                        "profileImageUrl": "https://example.com/author.png",
                    }
                ],
                "authorTags": {"Card A": ["Tag 1", "Tag 2"]},
                "hubs": [{"name": "Hub One"}],
                "colors": ["G"],
                "colorIdentity": ["G"],
                "boards": {
                    "mainboard": {
                        "count": 1,
                        "cards": {
                            "card-1": {
                                "quantity": 1,
                                "finish": "nonFoil",
                                "isFoil": False,
                                "isAlter": False,
                                "isProxy": False,
                                "card": {"name": "Card A"},
                            }
                        },
                    }
                },
                "tokens": [],
            }
        ],
    }

    stub_client = _StubMoxfieldClient(stub_payload)

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/TestUser/decks")

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["user_name"] == "TestUser"
    assert body["total_decks"] == 1
    assert body["decks"][0]["public_id"] == "deck-public"
    assert body["decks"][0]["boards"][0]["cards"][0]["card"]["name"] == "Card A"
    assert body["decks"][0]["tags"][0]["tags"] == ["Tag 1", "Tag 2"]


def test_get_user_profile_not_found(api_client: TestClient) -> None:
    """Fetching a profile that does not exist should yield 404."""
    response = api_client.get("/profiles/unknown-sub")
    assert response.status_code == 404


def test_upsert_user_profile_creates_and_updates_document(api_client: TestClient) -> None:
    """PUT /profiles/{google_sub} should upsert and return the stored profile."""
    first_payload = {
        "display_name": "Test User",
        "email": "test@example.com",
        "moxfield_handle": "Handle",
        "moxfield_decks": [
            {
                "public_id": "deck-1",
                "name": "Deck One",
                "format": "commander",
            }
        ],
    }

    response = api_client.put("/profiles/google-sub-123", json=first_payload)
    assert response.status_code == 200

    body = response.json()
    assert body["google_sub"] == "google-sub-123"
    assert body["display_name"] == "Test User"
    assert body["moxfield_handle"] == "Handle"
    assert len(body["moxfield_decks"]) == 1

    created_at = datetime.fromisoformat(body["created_at"].replace("Z", "+00:00"))
    updated_at = datetime.fromisoformat(body["updated_at"].replace("Z", "+00:00"))
    assert updated_at >= created_at

    stored_doc = api_client.app.state.stub_db["users"].documents[0]
    assert stored_doc["google_sub"] == "google-sub-123"
    assert stored_doc["moxfield_handle"] == "Handle"

    # perform an update that does not include decks to ensure they are preserved
    second_payload = {
        "display_name": "Updated Name",
        "picture": "https://example.com/avatar.png",
    }
    second_response = api_client.put("/profiles/google-sub-123", json=second_payload)
    assert second_response.status_code == 200

    updated_body = second_response.json()
    assert updated_body["display_name"] == "Updated Name"
    assert updated_body["picture"] == "https://example.com/avatar.png"
    assert len(updated_body["moxfield_decks"]) == 1  # preserved from first payload


def test_get_user_decks_not_found(api_client: TestClient) -> None:
    """The endpoint should convert client not-found errors into HTTP 404."""
    stub_client = _StubMoxfieldClient(error=MoxfieldNotFoundError("missing"))

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/Unknown/decks")

    assert response.status_code == 404
    assert response.json()["detail"] == "missing"


def test_get_user_decks_generic_error(api_client: TestClient) -> None:
    """Any other client error should surface as a 502."""
    stub_client = _StubMoxfieldClient(error=MoxfieldError("boom"))

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/Test/decks")

    assert response.status_code == 502
    assert response.json()["detail"] == "boom"


def test_get_user_deck_summaries_success(api_client: TestClient) -> None:
    """Deck summaries endpoint should omit card payloads while returning metadata."""
    stub_summary = {
        "userName": "TestUser",
        "displayName": "Test User",
        "profileImageUrl": "https://example.com/avatar.png",
        "badges": [],
    }
    stub_decks = [
        {
            "id": "deck123",
            "publicId": "deck-public",
            "name": "Sample Deck",
            "format": "commander",
            "visibility": "public",
            "description": "Example deck description.",
            "publicUrl": "https://moxfield.com/decks/deck-public",
            "createdAtUtc": "2024-01-01T00:00:00Z",
            "lastUpdatedAtUtc": "2024-01-02T00:00:00Z",
            "likeCount": 10,
            "viewCount": 20,
            "commentCount": 5,
            "bookmarkCount": 3,
            "colors": ["G"],
            "colorIdentity": ["G"],
            "hubs": [{"name": "Hub One"}],
        }
    ]

    stub_client = _StubMoxfieldClient(summary_payload=stub_summary, deck_summaries=stub_decks)

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/TestUser/deck-summaries")

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["user_name"] == "TestUser"
    assert body["total_decks"] == 1
    deck = body["decks"][0]
    assert deck["public_id"] == "deck-public"
    assert "boards" not in deck


def test_get_user_deck_summaries_not_found(api_client: TestClient) -> None:
    """Not found errors should surface as HTTP 404 for summaries."""
    stub_client = _StubMoxfieldClient(error=MoxfieldNotFoundError("missing"))

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/Unknown/deck-summaries")

    assert response.status_code == 404
    assert response.json()["detail"] == "missing"


def test_get_user_deck_summaries_generic_error(api_client: TestClient) -> None:
    """Any other client error should surface as a 502 for summaries."""
    stub_client = _StubMoxfieldClient(error=MoxfieldError("boom"))

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/Test/deck-summaries")

    assert response.status_code == 502
    assert response.json()["detail"] == "boom"


def test_get_cached_user_decks_returns_cached_payload(api_client: TestClient) -> None:
    """Cached endpoint should read back the stored document."""
    stub_payload = {
        "user": {
            "userName": "TestUser",
            "displayName": "Test User",
            "profileImageUrl": "https://example.com/avatar.png",
            "badges": [],
        },
        "decks": [
            {
                "publicId": "deck-public",
                "name": "Sample Deck",
                "format": "commander",
                "publicUrl": "https://moxfield.com/decks/deck-public",
                "createdAtUtc": "2024-01-01T00:00:00Z",
                "lastUpdatedAtUtc": "2024-01-02T00:00:00Z",
                "stats": {"likeCount": 0, "viewCount": 0, "commentCount": 0, "bookmarkCount": 0},
                "boards": {},
                "tokens": [],
            }
        ],
    }

    stub_client = _StubMoxfieldClient(stub_payload)
    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    # Prime the cache by calling the live endpoint.
    live_response = api_client.get("/users/TestUser/decks")
    assert live_response.status_code == 200

    cached_response = api_client.get("/cache/users/TestUser/decks")
    assert cached_response.status_code == 200
    data = cached_response.json()
    assert data["user"]["user_name"] == "TestUser"
    assert data["decks"][0]["public_id"] == "deck-public"


def test_get_cached_user_decks_returns_404_when_missing(api_client: TestClient) -> None:
    """Cached endpoint should return 404 when nothing has been stored."""
    response = api_client.get("/cache/users/Unknown/decks")
    assert response.status_code == 404
    assert response.json()["detail"] == "No cached deck data for this user."


def test_get_cached_deck_summaries_returns_cached_payload(api_client: TestClient) -> None:
    """Cached deck summaries endpoint should mirror stored documents."""
    stub_summary = {
        "userName": "TestUser",
        "displayName": "Test User",
        "profileImageUrl": None,
        "badges": [],
    }
    stub_decks = [
        {
            "publicId": "deck-public",
            "name": "Sample Deck",
            "format": "commander",
            "publicUrl": "https://moxfield.com/decks/deck-public",
            "createdAtUtc": "2024-01-01T00:00:00Z",
            "lastUpdatedAtUtc": "2024-01-02T00:00:00Z",
            "stats": {"likeCount": 0, "viewCount": 0, "commentCount": 0, "bookmarkCount": 0},
        }
    ]

    stub_client = _StubMoxfieldClient(summary_payload=stub_summary, deck_summaries=stub_decks)
    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    live_response = api_client.get("/users/TestUser/deck-summaries")
    assert live_response.status_code == 200

    cached_response = api_client.get("/cache/users/TestUser/deck-summaries")
    assert cached_response.status_code == 200
    data = cached_response.json()
    assert data["user"]["user_name"] == "TestUser"
    assert data["decks"][0]["public_id"] == "deck-public"


def test_get_cached_deck_summaries_returns_404_when_missing(api_client: TestClient) -> None:
    """Cached summaries endpoint returns 404 when user not found."""
    response = api_client.get("/cache/users/Unknown/deck-summaries")
    assert response.status_code == 404
    assert response.json()["detail"] == "No cached deck summaries for this user."
