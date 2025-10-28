"""MongoDB repository helpers for deck personalizations."""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo import ASCENDING, IndexModel

from ..config import get_settings


def _strip_storage_fields(document: dict[str, Any]) -> dict[str, Any]:
    clean = dict(document)
    clean.pop("_id", None)
    return clean


class DeckPersonalizationRepository:
    """Encapsulates Mongo persistence for user deck personalizations."""

    def __init__(self, database: AsyncIOMotorDatabase) -> None:
        settings = get_settings()
        self._collection: AsyncIOMotorCollection = database[
            settings.mongo_deck_personalizations_collection
        ]

    @staticmethod
    def _owner_filter(google_sub: str) -> dict[str, Any]:
        return {"google_sub": google_sub}

    @staticmethod
    def _id_filter(google_sub: str, deck_id: str) -> dict[str, Any]:
        return {"google_sub": google_sub, "deck_id": deck_id}

    async def find_one(self, google_sub: str, deck_id: str) -> dict[str, Any] | None:
        document = await self._collection.find_one(self._id_filter(google_sub, deck_id))
        return _strip_storage_fields(document) if document else None

    async def list_for_owner(self, google_sub: str) -> list[dict[str, Any]]:
        cursor = self._collection.find(self._owner_filter(google_sub))
        documents = await cursor.to_list(length=None)
        return [_strip_storage_fields(document) for document in documents]

    async def upsert(self, document: dict[str, Any]) -> dict[str, Any]:
        google_sub = document.get("google_sub")
        deck_id = document.get("deck_id")
        if not google_sub or not deck_id:
            raise ValueError("Deck personalization documents require 'google_sub' and 'deck_id'.")
        await self._collection.update_one(
            self._id_filter(google_sub, deck_id),
            {"$set": document},
            upsert=True,
        )
        stored = await self._collection.find_one(self._id_filter(google_sub, deck_id))
        if not stored:
            raise RuntimeError("Failed to persist deck personalization.")
        return _strip_storage_fields(stored)

    async def ensure_indexes(self) -> None:
        await self._collection.create_indexes(
            [
                IndexModel(
                    [("google_sub", ASCENDING), ("deck_id", ASCENDING)],
                    unique=True,
                    name="deck_personalization_owner_deck_unique",
                ),
                IndexModel(
                    [("google_sub", ASCENDING), ("updated_at", ASCENDING)],
                    name="deck_personalization_lookup",
                ),
            ]
        )


async def ensure_deck_personalization_indexes(database: AsyncIOMotorDatabase) -> None:
    """Ensure Mongo indexes exist for the personalization collection."""
    repository = DeckPersonalizationRepository(database)
    await repository.ensure_indexes()
