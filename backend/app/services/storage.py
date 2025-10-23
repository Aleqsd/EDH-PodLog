"""MongoDB persistence helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..logging_utils import get_logger
from ..repositories import MoxfieldCacheRepository
from ..schemas import (
    DeckDetail,
    DeckSummary,
    UserDeckSummariesResponse,
    UserDecksResponse,
    UserSummary,
)

logger = get_logger("storage")


async def upsert_user_decks(
    database: AsyncIOMotorDatabase, payload: UserDecksResponse
) -> None:
    """Persist the latest deck snapshot for a user."""
    repository = MoxfieldCacheRepository(database)
    synced_at = datetime.now(timezone.utc)
    user_doc = payload.user.model_dump(mode="python")
    user_doc["synced_at"] = synced_at
    user_doc["total_decks"] = payload.total_decks

    logger.info(
        "Mongo write: upserting %d deck(s) for user '%s'",
        len(payload.decks),
        payload.user.user_name,
    )

    await repository.replace_user(user_doc)

    deck_documents = []
    for deck in payload.decks:
        deck_doc = deck.model_dump(mode="python")
        deck_doc["user_name"] = payload.user.user_name
        deck_doc["synced_at"] = synced_at
        deck_documents.append(deck_doc)
    await repository.replace_decks(payload.user.user_name, deck_documents)


async def upsert_user_deck_summaries(
    database: AsyncIOMotorDatabase, payload: UserDeckSummariesResponse
) -> None:
    """Persist the lighter deck summary snapshot for a user."""
    repository = MoxfieldCacheRepository(database)
    synced_at = datetime.now(timezone.utc)
    user_doc = payload.user.model_dump(mode="python")
    user_doc["synced_at"] = synced_at
    user_doc["total_decks"] = payload.total_decks

    logger.info(
        "Mongo write: upserting %d deck summary document(s) for user '%s'",
        len(payload.decks),
        payload.user.user_name,
    )

    await repository.replace_user(user_doc)

    summary_documents = []
    for deck in payload.decks:
        deck_doc = deck.model_dump(mode="python")
        deck_doc["user_name"] = payload.user.user_name
        deck_doc["synced_at"] = synced_at
        summary_documents.append(deck_doc)
    await repository.replace_deck_summaries(payload.user.user_name, summary_documents)


async def fetch_user_decks(
    database: AsyncIOMotorDatabase, username: str
) -> UserDecksResponse | None:
    """Return the cached deck payload for a user if present."""
    repository = MoxfieldCacheRepository(database)
    logger.info("Mongo read: fetching cached decks for user '%s'", username)

    user_doc = await repository.fetch_user(username)
    if not user_doc:
        logger.info("Mongo read: no cached decks found for user '%s'", username)
        return None

    deck_docs = await repository.fetch_decks(username)
    deck_payloads = [
        DeckDetail.model_validate(_strip_deck_storage_fields(deck_doc)) for deck_doc in deck_docs
    ]

    user_summary = UserSummary.model_validate(_strip_user_storage_fields(user_doc))
    total_decks = user_doc.get("total_decks", len(deck_payloads))

    logger.info(
        "Mongo read: returning %d deck(s) for user '%s'", len(deck_payloads), username
    )

    return UserDecksResponse(user=user_summary, total_decks=total_decks, decks=deck_payloads)


async def fetch_user_deck_summaries(
    database: AsyncIOMotorDatabase, username: str
) -> UserDeckSummariesResponse | None:
    """Return the cached deck summaries for a user if present."""
    repository = MoxfieldCacheRepository(database)
    logger.info("Mongo read: fetching deck summaries for user '%s'", username)

    user_doc = await repository.fetch_user(username)
    if not user_doc:
        logger.info("Mongo read: no cached deck summaries found for user '%s'", username)
        return None

    summary_docs = await repository.fetch_deck_summaries(username)
    summaries = [
        DeckSummary.model_validate(_strip_deck_storage_fields(summary_doc)) for summary_doc in summary_docs
    ]

    user_summary = UserSummary.model_validate(_strip_user_storage_fields(user_doc))
    total_decks = user_doc.get("total_decks", len(summaries))

    logger.info(
        "Mongo read: returning %d deck summary document(s) for user '%s'",
        len(summaries),
        username,
    )

    return UserDeckSummariesResponse(user=user_summary, total_decks=total_decks, decks=summaries)


async def delete_user_deck(
    database: AsyncIOMotorDatabase, username: str, deck_id: str
) -> bool:
    """Delete a deck and its summary for the given user. Returns True when a deck was removed."""
    repository = MoxfieldCacheRepository(database)

    logger.info(
        "Mongo write: deleting deck '%s' for user '%s'",
        deck_id,
        username,
    )

    deleted_count = await repository.delete_deck(username, deck_id)

    if deleted_count == 0:
        logger.info(
            "Mongo write: deck '%s' for user '%s' not found (no deletion performed)",
            deck_id,
            username,
        )
        return False

    remaining = await repository.count_decks(username)
    await repository.users.update_one(
        repository.user_filter(username),
        {"$set": {"total_decks": remaining}},
    )

    logger.info(
        "Mongo write: deck '%s' deleted for user '%s' (remaining decks: %d)",
        deck_id,
        username,
        remaining,
    )

    return True


def _strip_deck_storage_fields(document: dict[str, Any]) -> dict[str, Any]:
    """Drop internal storage metadata before validating with Pydantic."""
    clean_doc = dict(document)
    clean_doc.pop("_id", None)
    clean_doc.pop("user_name", None)
    clean_doc.pop("user_key", None)
    clean_doc.pop("synced_at", None)
    return clean_doc


def _strip_user_storage_fields(document: dict[str, Any]) -> dict[str, Any]:
    """Drop storage metadata for user documents while keeping the identifier."""
    clean_doc = dict(document)
    clean_doc.pop("_id", None)
    clean_doc.pop("synced_at", None)
    clean_doc.pop("total_decks", None)
    clean_doc.pop("user_key", None)
    return clean_doc
