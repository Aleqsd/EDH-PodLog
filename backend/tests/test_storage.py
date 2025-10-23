"""Tests for MongoDB storage helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from copy import deepcopy

import pytest

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas import (
    DeckBoard,
    DeckCard,
    DeckDetail,
    DeckStats,
    DeckSummary,
    UserDeckSummariesResponse,
    UserDecksResponse,
    UserSummary,
)
from app.services.storage import (
    delete_user_deck,
    fetch_user_deck_summaries,
    fetch_user_decks,
    upsert_user_deck_summaries,
    upsert_user_decks,
)


@pytest.fixture()
def anyio_backend() -> str:
    """Force AnyIO tests to run against asyncio to avoid optional dependencies."""
    return "asyncio"


class _StubCursor:
    """Very small subset of the Motor cursor used in tests."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self._documents = documents

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return deepcopy(self._documents if length is None else self._documents[:length])


class _StubCollection:
    """In-memory collection that mimics the methods used by the storage helpers."""

    def __init__(self) -> None:
        self.documents: list[dict[str, Any]] = []

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

    async def delete_one(self, filter_: dict[str, Any]):
        for index, document in enumerate(self.documents):
            if self._matches(document, filter_):
                self.documents.pop(index)
                return type("DeleteResult", (), {"deleted_count": 1})()
        return type("DeleteResult", (), {"deleted_count": 0})()

    async def count_documents(self, filter_: dict[str, Any]) -> int:
        return sum(1 for document in self.documents if self._matches(document, filter_))


class _StubDatabase:
    """Dictionary-like helper that returns stub collections."""

    def __init__(self) -> None:
        self._collections: dict[str, _StubCollection] = {}

    def __getitem__(self, name: str) -> _StubCollection:
        if name not in self._collections:
            self._collections[name] = _StubCollection()
        return self._collections[name]


def _build_user_payload() -> UserSummary:
    return UserSummary(
        user_name="TestUser",
        display_name="Test User",
        profile_image_url="https://example.com/avatar.png",
        profile_url="https://moxfield.com/users/TestUser",
        badges=[],
    )


def _build_deck_detail() -> DeckDetail:
    board = DeckBoard(
        name="mainboard",
        cards=[DeckCard(quantity=1, card={"name": "Card A"})],
    )
    return DeckDetail(
        public_id="deck-public",
        name="Sample Deck",
        format="commander",
        public_url="https://moxfield.com/decks/deck-public",
        boards=[board],
        stats=DeckStats(),
        tokens=[],
    )


def _build_deck_summary() -> DeckSummary:
    return DeckSummary(
        public_id="deck-public",
        name="Sample Deck",
        format="commander",
        public_url="https://moxfield.com/decks/deck-public",
        stats=DeckStats(),
    )


@pytest.mark.anyio("asyncio")
async def test_upsert_user_decks_persists_user_and_decks() -> None:
    """Deck details should be upserted under the configured collections."""
    database = _StubDatabase()
    payload = UserDecksResponse(
        user=_build_user_payload(),
        total_decks=1,
        decks=[_build_deck_detail()],
    )

    await upsert_user_decks(database, payload)

    stored_users = database["moxfield_users"].documents
    stored_decks = database["decks"].documents
    assert len(stored_users) == 1
    assert len(stored_decks) == 1

    user_document = stored_users[0]
    deck_document = stored_decks[0]
    assert user_document["user_name"] == "TestUser"
    assert user_document["total_decks"] == 1
    assert isinstance(user_document["synced_at"], datetime)
    assert user_document["user_key"] == "testuser"

    assert deck_document["public_id"] == "deck-public"
    assert deck_document["user_name"] == "TestUser"
    assert deck_document["user_key"] == "testuser"
    assert isinstance(deck_document["synced_at"], datetime)


@pytest.mark.anyio("asyncio")
async def test_upsert_user_deck_summaries_persists_user_and_summaries() -> None:
    """Deck summaries should be stored separately from full deck payloads."""
    database = _StubDatabase()
    payload = UserDeckSummariesResponse(
        user=_build_user_payload(),
        total_decks=1,
        decks=[_build_deck_summary()],
    )

    await upsert_user_deck_summaries(database, payload)

    stored_users = database["moxfield_users"].documents
    stored_summaries = database["deck_summaries"].documents
    assert len(stored_users) == 1
    assert len(stored_summaries) == 1

    summary_document = stored_summaries[0]
    assert summary_document["public_id"] == "deck-public"
    assert summary_document["user_name"] == "TestUser"
    assert summary_document["user_key"] == "testuser"
    assert isinstance(summary_document["synced_at"], datetime)


@pytest.mark.anyio("asyncio")
async def test_fetch_user_decks_returns_payload_if_present() -> None:
    """fetch_user_decks should reconstruct the response using stored documents."""
    database = _StubDatabase()
    payload = UserDecksResponse(
        user=_build_user_payload(),
        total_decks=1,
        decks=[_build_deck_detail()],
    )
    await upsert_user_decks(database, payload)

    cached = await fetch_user_decks(database, "TestUser")
    assert cached is not None
    assert cached.user.user_name == "TestUser"
    assert cached.total_decks == 1
    assert cached.decks[0].public_id == "deck-public"


@pytest.mark.anyio("asyncio")
async def test_fetch_user_decks_returns_none_when_missing() -> None:
    """fetch_user_decks should return None when no user document exists."""
    database = _StubDatabase()
    cached = await fetch_user_decks(database, "Unknown")
    assert cached is None


@pytest.mark.anyio("asyncio")
async def test_delete_user_deck_matches_case_insensitive_username() -> None:
    """Deleting a deck should match regardless of username casing."""
    database = _StubDatabase()
    payload = UserDecksResponse(
        user=_build_user_payload(),
        total_decks=1,
        decks=[_build_deck_detail()],
    )
    await upsert_user_decks(database, payload)
    summary_payload = UserDeckSummariesResponse(
        user=_build_user_payload(),
        total_decks=1,
        decks=[_build_deck_summary()],
    )
    await upsert_user_deck_summaries(database, summary_payload)

    deleted = await delete_user_deck(database, "testuser", "deck-public")
    assert deleted is True

    assert database["decks"].documents == []
    assert database["deck_summaries"].documents == []
    stored_user = database["moxfield_users"].documents[0]
    assert stored_user["total_decks"] == 0


@pytest.mark.anyio("asyncio")
async def test_fetch_user_deck_summaries_returns_payload_if_present() -> None:
    """fetch_user_deck_summaries should reuse stored summary documents."""
    database = _StubDatabase()
    payload = UserDeckSummariesResponse(
        user=_build_user_payload(),
        total_decks=1,
        decks=[_build_deck_summary()],
    )
    await upsert_user_deck_summaries(database, payload)

    cached = await fetch_user_deck_summaries(database, "TestUser")
    assert cached is not None
    assert cached.user.user_name == "TestUser"
    assert cached.decks[0].public_id == "deck-public"


@pytest.mark.anyio("asyncio")
async def test_fetch_user_deck_summaries_returns_none_when_missing() -> None:
    """fetch_user_deck_summaries should return None when nothing is stored."""
    database = _StubDatabase()
    cached = await fetch_user_deck_summaries(database, "Unknown")
    assert cached is None
