"""MongoDB persistence helpers."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..config import get_settings
from ..schemas import (
    DeckDetail,
    DeckSummary,
    UserDeckSummariesResponse,
    UserDecksResponse,
    UserSummary,
)

logger = logging.getLogger(__name__)


async def upsert_user_decks(
    database: AsyncIOMotorDatabase, payload: UserDecksResponse
) -> None:
    """Persist the latest deck snapshot for a user."""
    settings = get_settings()
    users = database[settings.mongo_users_collection]
    decks = database[settings.mongo_decks_collection]

    synced_at = datetime.now(timezone.utc)
    user_doc = payload.user.model_dump(mode="python")
    user_doc["synced_at"] = synced_at
    user_doc["total_decks"] = payload.total_decks

    logger.info(
        "Mongo write: upserting %d deck(s) for user '%s'",
        len(payload.decks),
        payload.user.user_name,
    )

    await users.update_one(
        {"user_name": payload.user.user_name},
        {"$set": user_doc},
        upsert=True,
    )

    for deck in payload.decks:
        deck_doc = deck.model_dump(mode="python")
        deck_doc["user_name"] = payload.user.user_name
        deck_doc["synced_at"] = synced_at
        await decks.update_one(
            {"public_id": deck.public_id, "user_name": payload.user.user_name},
            {"$set": deck_doc},
            upsert=True,
        )


async def upsert_user_deck_summaries(
    database: AsyncIOMotorDatabase, payload: UserDeckSummariesResponse
) -> None:
    """Persist the lighter deck summary snapshot for a user."""
    settings = get_settings()
    users = database[settings.mongo_users_collection]
    deck_summaries = database[settings.mongo_deck_summaries_collection]

    synced_at = datetime.now(timezone.utc)
    user_doc = payload.user.model_dump(mode="python")
    user_doc["synced_at"] = synced_at
    user_doc["total_decks"] = payload.total_decks

    logger.info(
        "Mongo write: upserting %d deck summary document(s) for user '%s'",
        len(payload.decks),
        payload.user.user_name,
    )

    await users.update_one(
        {"user_name": payload.user.user_name},
        {"$set": user_doc},
        upsert=True,
    )

    for deck in payload.decks:
        deck_doc = deck.model_dump(mode="python")
        deck_doc["user_name"] = payload.user.user_name
        deck_doc["synced_at"] = synced_at
        await deck_summaries.update_one(
            {"public_id": deck.public_id, "user_name": payload.user.user_name},
            {"$set": deck_doc},
            upsert=True,
        )


async def fetch_user_decks(
    database: AsyncIOMotorDatabase, username: str
) -> UserDecksResponse | None:
    """Return the cached deck payload for a user if present."""
    settings = get_settings()
    users = database[settings.mongo_users_collection]
    decks = database[settings.mongo_decks_collection]

    logger.info("Mongo read: fetching cached decks for user '%s'", username)

    user_doc = await users.find_one({"user_name": username})
    if not user_doc:
        logger.info("Mongo read: no cached decks found for user '%s'", username)
        return None

    deck_docs = await decks.find({"user_name": username}).to_list(length=None)
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
    settings = get_settings()
    users = database[settings.mongo_users_collection]
    deck_summaries = database[settings.mongo_deck_summaries_collection]

    logger.info("Mongo read: fetching deck summaries for user '%s'", username)

    user_doc = await users.find_one({"user_name": username})
    if not user_doc:
        logger.info("Mongo read: no cached deck summaries found for user '%s'", username)
        return None

    summary_docs = await deck_summaries.find({"user_name": username}).to_list(length=None)
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
    settings = get_settings()
    decks = database[settings.mongo_decks_collection]
    deck_summaries = database[settings.mongo_deck_summaries_collection]
    users = database[settings.mongo_users_collection]

    logger.info(
        "Mongo write: deleting deck '%s' for user '%s'",
        deck_id,
        username,
    )

    deck_result = await decks.delete_one({"user_name": username, "public_id": deck_id})
    await deck_summaries.delete_one({"user_name": username, "public_id": deck_id})

    if deck_result.deleted_count == 0:
        logger.info(
            "Mongo write: deck '%s' for user '%s' not found (no deletion performed)",
            deck_id,
            username,
        )
        return False

    remaining = await decks.count_documents({"user_name": username})
    await users.update_one(
        {"user_name": username},
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
    clean_doc.pop("synced_at", None)
    return clean_doc


def _strip_user_storage_fields(document: dict[str, Any]) -> dict[str, Any]:
    """Drop storage metadata for user documents while keeping the identifier."""
    clean_doc = dict(document)
    clean_doc.pop("_id", None)
    clean_doc.pop("synced_at", None)
    clean_doc.pop("total_decks", None)
    return clean_doc
