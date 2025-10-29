"""MongoDB repository helpers for user follow relationships."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo import ASCENDING, IndexModel

from ..config import get_settings
from ..logging_utils import get_logger

logger = get_logger("repositories.follows")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _strip_storage_fields(document: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(document or {})
    cleaned.pop("_id", None)
    return cleaned


class FollowRepository:
    """Encapsulates Mongo persistence for follow relationships."""

    def __init__(self, database: AsyncIOMotorDatabase) -> None:
        settings = get_settings()
        self._collection: AsyncIOMotorCollection = database[settings.mongo_follows_collection]

    @staticmethod
    def _key_filter(follower_sub: str, target_sub: str) -> dict[str, Any]:
        return {"follower_sub": follower_sub, "target_sub": target_sub}

    async def list_following(self, follower_sub: str) -> list[dict[str, Any]]:
        cursor = self._collection.find({"follower_sub": follower_sub})
        documents = await cursor.to_list(length=None)
        cleaned = [_strip_storage_fields(document) for document in documents]
        cleaned.sort(
            key=lambda entry: entry.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        return cleaned

    async def list_followers(self, target_sub: str) -> list[dict[str, Any]]:
        cursor = self._collection.find({"target_sub": target_sub})
        documents = await cursor.to_list(length=None)
        cleaned = [_strip_storage_fields(document) for document in documents]
        cleaned.sort(
            key=lambda entry: entry.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        return cleaned

    async def add_follow(self, follower_sub: str, target_sub: str) -> dict[str, Any]:
        now = _now()
        document = {
            "follower_sub": follower_sub,
            "target_sub": target_sub,
            "created_at": now,
            "updated_at": now,
        }
        await self._collection.update_one(
            self._key_filter(follower_sub, target_sub),
            {"$set": document},
            upsert=True,
        )
        return document

    async def remove_follow(self, follower_sub: str, target_sub: str) -> bool:
        result = await self._collection.delete_one(self._key_filter(follower_sub, target_sub))
        return getattr(result, "deleted_count", 0) > 0

    async def is_following(self, follower_sub: str, target_sub: str) -> bool:
        document = await self._collection.find_one(self._key_filter(follower_sub, target_sub))
        return document is not None

    async def count_followers(self, target_sub: str) -> int:
        return await self._collection.count_documents({"target_sub": target_sub})

    async def count_following(self, follower_sub: str) -> int:
        return await self._collection.count_documents({"follower_sub": follower_sub})

    async def ensure_indexes(self) -> None:
        logger.info("Ensuring Mongo indexes for follows collection.")
        await self._collection.create_indexes(
            [
                IndexModel(
                    [("follower_sub", ASCENDING), ("target_sub", ASCENDING)],
                    unique=True,
                    name="follower_target_unique",
                ),
                IndexModel([("target_sub", ASCENDING)], name="follows_target_lookup"),
                IndexModel([("follower_sub", ASCENDING)], name="follows_follower_lookup"),
            ]
        )


async def ensure_follow_indexes(database: AsyncIOMotorDatabase) -> None:
    """Ensure indexes exist for the follows collection."""
    repository = FollowRepository(database)
    await repository.ensure_indexes()
