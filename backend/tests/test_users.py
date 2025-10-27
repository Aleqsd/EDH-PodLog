"""Tests for user-facing FastAPI endpoints."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_moxfield_client
from app.moxfield import MoxfieldError, MoxfieldNotFoundError
from app.routers import cache_router, profiles_router, users_router
from backend.tests.utils import StubMoxfieldClient


@pytest.fixture(scope="module", autouse=True)
def _ensure_router_prefixes() -> None:
    """Simple sanity check that routers expose the expected prefixes."""
    assert users_router.prefix == "/users"
    assert profiles_router.prefix == "/profiles"
    assert cache_router.prefix == "/cache"


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

    stub_client = StubMoxfieldClient(stub_payload)

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


def test_get_user_decks_color_identity_from_cards(api_client: TestClient) -> None:
    """Deck color identity should derive from the contained card data."""
    stub_payload = {
        "user": {
            "userName": "ColorUser",
            "displayName": "Color User",
            "profileImageUrl": None,
            "badges": [],
        },
        "decks": [
            {
                "id": "deck-color",
                "publicId": "deck-color",
                "name": "Color Deck",
                "format": "commander",
                "visibility": "public",
                "description": None,
                "publicUrl": "https://moxfield.com/decks/deck-color",
                "createdAtUtc": None,
                "lastUpdatedAtUtc": None,
                "likeCount": 0,
                "viewCount": 0,
                "commentCount": 0,
                "bookmarkCount": 0,
                "createdByUser": None,
                "authors": [],
                "authorTags": {},
                "hubs": [],
                "colors": [],
                "colorIdentity": [],
                "boards": {
                    "mainboard": {
                        "count": 2,
                        "cards": {
                            "entry-1": {
                                "quantity": 1,
                                "card": {
                                    "name": "Card A",
                                    "color_identity": ["B", "U"],
                                },
                            },
                            "entry-2": {
                                "quantity": 1,
                                "card": {
                                    "name": "Card B",
                                    "colorIdentity": ["R"],
                                },
                            },
                        },
                    }
                },
                "tokens": [],
            }
        ],
    }

    stub_client = StubMoxfieldClient(stub_payload)

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/ColorUser/decks")

    assert response.status_code == 200
    body = response.json()
    deck = body["decks"][0]
    assert deck["color_identity"] == ["U", "B", "R"]


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
    stub_client = StubMoxfieldClient(error=MoxfieldNotFoundError("missing"))

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/Unknown/decks")

    assert response.status_code == 404
    assert response.json()["detail"] == "missing"


def test_get_user_decks_generic_error(api_client: TestClient) -> None:
    """Any other client error should surface as a 502."""
    stub_client = StubMoxfieldClient(error=MoxfieldError("boom"))

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

    stub_client = StubMoxfieldClient(summary_payload=stub_summary, deck_summaries=stub_decks)

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
    stub_client = StubMoxfieldClient(error=MoxfieldNotFoundError("missing"))

    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/Unknown/deck-summaries")

    assert response.status_code == 404
    assert response.json()["detail"] == "missing"


def test_get_user_deck_summaries_generic_error(api_client: TestClient) -> None:
    """Any other client error should surface as a 502 for summaries."""
    stub_client = StubMoxfieldClient(error=MoxfieldError("boom"))

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

    stub_client = StubMoxfieldClient(stub_payload)
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

    stub_client = StubMoxfieldClient(summary_payload=stub_summary, deck_summaries=stub_decks)
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


def test_delete_user_deck_removes_documents_and_updates_cache(api_client: TestClient) -> None:
    """Deleting a cached deck should remove the document and update cached totals."""
    stub_payload = {
        "user": {
            "userName": "TestUser",
            "displayName": "Test User",
            "profileImageUrl": "https://example.com/avatar.png",
            "badges": [],
        },
        "decks": [
            {
                "id": "deck-001",
                "publicId": "deck-one",
                "name": "Deck One",
                "format": "commander",
                "visibility": "public",
                "description": "Deck one description.",
                "publicUrl": "https://moxfield.com/decks/deck-one",
                "createdAtUtc": "2024-01-01T00:00:00Z",
                "lastUpdatedAtUtc": "2024-01-02T00:00:00Z",
                "likeCount": 5,
                "viewCount": 10,
                "commentCount": 1,
                "bookmarkCount": 0,
                "createdByUser": {"userName": "Author"},
                "authors": [{"userName": "Author"}],
                "authorTags": {"Card A": ["Tag 1"]},
                "hubs": [{"name": "Hub"}],
                "colors": ["U"],
                "colorIdentity": ["U"],
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
            },
            {
                "id": "deck-002",
                "publicId": "deck-two",
                "name": "Deck Two",
                "format": "commander",
                "visibility": "public",
                "description": "Deck two description.",
                "publicUrl": "https://moxfield.com/decks/deck-two",
                "createdAtUtc": "2024-01-03T00:00:00Z",
                "lastUpdatedAtUtc": "2024-01-04T00:00:00Z",
                "likeCount": 0,
                "viewCount": 0,
                "commentCount": 0,
                "bookmarkCount": 0,
                "createdByUser": {"userName": "Author"},
                "authors": [{"userName": "Author"}],
                "authorTags": {"Card B": ["Tag 2"]},
                "hubs": [{"name": "Hub"}],
                "colors": ["B"],
                "colorIdentity": ["B"],
                "boards": {
                    "mainboard": {
                        "count": 1,
                        "cards": {
                            "card-2": {
                                "quantity": 1,
                                "finish": "nonFoil",
                                "isFoil": False,
                                "isAlter": False,
                                "isProxy": False,
                                "card": {"name": "Card B"},
                            }
                        },
                    }
                },
                "tokens": [],
            },
        ],
    }

    stub_client = StubMoxfieldClient(stub_payload)
    app = api_client.app
    app.dependency_overrides[get_moxfield_client] = lambda: stub_client

    response = api_client.get("/users/TestUser/decks")
    assert response.status_code == 200

    deck_collection = app.state.stub_db["decks"].documents
    assert len(deck_collection) == 2
    user_doc = app.state.stub_db["moxfield_users"].documents[0]
    assert user_doc["total_decks"] == 2

    delete_response = api_client.delete("/users/TestUser/decks/deck-one")
    assert delete_response.status_code == 204

    remaining_decks = app.state.stub_db["decks"].documents
    assert len(remaining_decks) == 1
    assert remaining_decks[0]["public_id"] == "deck-two"

    updated_user_doc = app.state.stub_db["moxfield_users"].documents[0]
    assert updated_user_doc["total_decks"] == 1

    cached_response = api_client.get("/cache/users/TestUser/decks")
    assert cached_response.status_code == 200
    cached_payload = cached_response.json()
    assert cached_payload["total_decks"] == 1
    assert cached_payload["decks"][0]["public_id"] == "deck-two"


def test_delete_user_deck_returns_404_for_unknown_identifier(api_client: TestClient) -> None:
    """Deleting a non-existent deck should return HTTP 404 and keep cache untouched."""
    response = api_client.delete("/users/TestUser/decks/missing-deck")
    assert response.status_code == 404
    assert response.json()["detail"] == "Deck not found."
