"""MongoDB repository helpers for cached Moxfield payloads."""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo import ASCENDING, IndexModel

from ..config import get_settings
from ..logging_utils import get_logger

logger = get_logger("repositories.moxfield_cache")


class MoxfieldCacheRepository:
    """Encapsulates Mongo persistence details for cached Moxfield data."""

    def __init__(self, database: AsyncIOMotorDatabase) -> None:
        settings = get_settings()
        self._settings = settings
        self._database = database
        self.users: AsyncIOMotorCollection = database[settings.mongo_moxfield_users_collection]
        self.decks: AsyncIOMotorCollection = database[settings.mongo_decks_collection]
        self.deck_summaries: AsyncIOMotorCollection = database[
            settings.mongo_deck_summaries_collection
        ]

    @staticmethod
    def canonical_username(username: str) -> str:
        """Return the canonical key for usernames."""
        return username.lower()

    def user_filter(self, username: str) -> dict[str, Any]:
        """Build a lookup filter for user-specific documents."""
        canonical = self.canonical_username(username)
        return {"$or": [{"user_key": canonical}, {"user_name": username}]}

    def deck_filter(self, username: str, deck_id: str) -> dict[str, Any]:
        """Build a lookup filter that matches deck documents for a user."""
        canonical = self.canonical_username(username)
        return {
            "$or": [
                {"user_key": canonical, "public_id": deck_id},
                {"user_name": username, "public_id": deck_id},
            ]
        }

    async def replace_user(self, document: dict[str, Any]) -> None:
        """Replace or upsert a user cache document."""
        username = document.get("user_name")
        if not isinstance(username, str):
            raise ValueError("User document must include a 'user_name' string.")
        canonical = self.canonical_username(username)

        doc = dict(document)
        doc["user_name"] = username
        doc["user_key"] = canonical

        await self.users.replace_one(self.user_filter(username), doc, upsert=True)

    async def replace_decks(
        self, username: str, documents: Iterable[dict[str, Any]]
    ) -> None:
        """Replace or upsert deck documents for a user."""
        canonical = self.canonical_username(username)
        for document in documents:
            public_id = document.get("public_id")
            if not isinstance(public_id, str):
                raise ValueError("Deck documents must include a 'public_id' string.")
            doc = dict(document)
            doc["user_name"] = username
            doc["user_key"] = canonical
            await self.decks.replace_one(self.deck_filter(username, public_id), doc, upsert=True)

    async def replace_deck_summaries(
        self, username: str, documents: Iterable[dict[str, Any]]
    ) -> None:
        """Replace or upsert deck summary documents for a user."""
        canonical = self.canonical_username(username)
        for document in documents:
            public_id = document.get("public_id")
            if not isinstance(public_id, str):
                raise ValueError("Deck summary documents must include a 'public_id' string.")
            doc = dict(document)
            doc["user_name"] = username
            doc["user_key"] = canonical
            await self.deck_summaries.replace_one(
                self.deck_filter(username, public_id), doc, upsert=True
            )

    async def fetch_user(self, username: str) -> dict[str, Any] | None:
        """Return the cached user document, if present."""
        return await self.users.find_one(self.user_filter(username))

    async def fetch_decks(self, username: str) -> list[dict[str, Any]]:
        """Return deck documents for a given user."""
        cursor = self.decks.find(self.user_filter(username))
        return await cursor.to_list(length=None)

    async def fetch_deck_summaries(self, username: str) -> list[dict[str, Any]]:
        """Return deck summary documents for a given user."""
        cursor = self.deck_summaries.find(self.user_filter(username))
        return await cursor.to_list(length=None)

    async def delete_deck(self, username: str, deck_id: str) -> int:
        """Delete deck data (deck + summary) for the given identifier."""
        delete_filter = self.deck_filter(username, deck_id)
        deck_result = await self.decks.delete_one(delete_filter)
        await self.deck_summaries.delete_one(delete_filter)
        return deck_result.deleted_count

    async def count_decks(self, username: str) -> int:
        """Return the number of stored deck documents for a user."""
        return await self.decks.count_documents(self.user_filter(username))

    async def ensure_indexes(self) -> None:
        """Create indexes required for efficient lookups."""
        logger.info("Ensuring Mongo indexes for moxfield cache collections.")

        await self._create_indexes(
            self.users,
            [
                IndexModel([("user_key", ASCENDING)], name="user_key_unique", unique=True),
                IndexModel([("user_name", ASCENDING)], name="user_name_lookup"),
            ],
        )
        await self._create_indexes(
            self.decks,
            [
                IndexModel(
                    [("user_key", ASCENDING), ("public_id", ASCENDING)],
                    name="user_public_id_unique",
                    unique=True,
                ),
                IndexModel([("user_key", ASCENDING)], name="deck_user_key_lookup"),
            ],
        )
        await self._create_indexes(
            self.deck_summaries,
            [
                IndexModel(
                    [("user_key", ASCENDING), ("public_id", ASCENDING)],
                    name="summary_user_public_id_unique",
                    unique=True,
                ),
                IndexModel([("user_key", ASCENDING)], name="summary_user_key_lookup"),
            ],
        )

    @staticmethod
    async def _create_indexes(
        collection: AsyncIOMotorCollection, indexes: Sequence[IndexModel]
    ) -> None:
        if not indexes:
            return
        await collection.create_indexes(indexes)


async def ensure_moxfield_cache_indexes(database: AsyncIOMotorDatabase) -> None:
    """Ensure Mongo indexes exist for collections backing the Moxfield cache."""
    repository = MoxfieldCacheRepository(database)
    await repository.ensure_indexes()
