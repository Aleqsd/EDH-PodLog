"""MongoDB repository helpers for tracked players."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo import ASCENDING, IndexModel

from ..config import get_settings
from ..logging_utils import get_logger
from ..schemas import PlayerType

logger = get_logger("repositories.players")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _strip_storage_fields(document: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(document or {})
    cleaned.pop("_id", None)
    return cleaned


class PlayerRepository:
    """Encapsulates Mongo persistence for tracked players."""

    def __init__(self, database: AsyncIOMotorDatabase) -> None:
        settings = get_settings()
        self._collection: AsyncIOMotorCollection = database[settings.mongo_players_collection]

    @staticmethod
    def _owner_filter(owner_sub: str) -> dict[str, Any]:
        return {"owner_sub": owner_sub}

    @staticmethod
    def _id_filter(owner_sub: str, player_id: str) -> dict[str, Any]:
        return {"owner_sub": owner_sub, "id": player_id}

    async def list_for_owner(self, owner_sub: str) -> list[dict[str, Any]]:
        cursor = self._collection.find(self._owner_filter(owner_sub))
        documents = await cursor.to_list(length=None)
        cleaned = [_strip_storage_fields(document) for document in documents]
        cleaned.sort(
            key=lambda entry: entry.get("updated_at") or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        return cleaned

    async def find_by_id(self, owner_sub: str, player_id: str) -> dict[str, Any] | None:
        document = await self._collection.find_one(self._id_filter(owner_sub, player_id))
        return _strip_storage_fields(document) if document else None

    async def create(
        self,
        owner_sub: str,
        name: str,
        *,
        player_type: PlayerType = PlayerType.GUEST,
        google_sub: str | None = None,
    ) -> dict[str, Any]:
        now = _now()
        player_id = uuid4().hex
        document = {
            "id": player_id,
            "owner_sub": owner_sub,
            "name": name.strip(),
            "player_type": player_type.value,
            "google_sub": google_sub,
            "linked_google_sub": google_sub,
            "created_at": now,
            "updated_at": now,
        }
        await self._collection.update_one(
            self._id_filter(owner_sub, player_id),
            {"$set": document},
            upsert=True,
        )
        return document

    async def save(self, document: dict[str, Any]) -> dict[str, Any]:
        if "id" not in document or "owner_sub" not in document:
            raise ValueError("Player documents must include 'id' and 'owner_sub'.")
        await self._collection.update_one(
            self._id_filter(document["owner_sub"], document["id"]),
            {"$set": document},
            upsert=True,
        )
        return document

    async def update(
        self,
        owner_sub: str,
        player_id: str,
        *,
        name: str | None = None,
        player_type: PlayerType | None = None,
        google_sub: str | None = None,
    ) -> dict[str, Any] | None:
        document = await self.find_by_id(owner_sub, player_id)
        if not document:
            return None

        updates: dict[str, Any] = {"updated_at": _now()}
        if name is not None:
            updates["name"] = name.strip()
        if player_type is not None:
            updates["player_type"] = player_type.value
        if google_sub is not None:
            updates["google_sub"] = google_sub
            updates["linked_google_sub"] = google_sub

        document.update(updates)
        await self._collection.update_one(
            self._id_filter(owner_sub, player_id),
            {"$set": document},
            upsert=True,
        )
        return document

    async def delete(self, owner_sub: str, player_id: str) -> bool:
        result = await self._collection.delete_one(self._id_filter(owner_sub, player_id))
        return getattr(result, "deleted_count", 0) > 0

    async def link_to_google_sub(
        self,
        owner_sub: str,
        player_id: str,
        google_sub: str,
    ) -> dict[str, Any] | None:
        document = await self.find_by_id(owner_sub, player_id)
        if not document:
            return None

        updated = await self.update(
            owner_sub,
            player_id,
            player_type=PlayerType.USER,
            google_sub=google_sub,
        )
        return updated

    async def ensure_indexes(self) -> None:
        logger.info("Ensuring Mongo indexes for players collection.")
        await self._collection.create_indexes(
            [
                IndexModel(
                    [("owner_sub", ASCENDING), ("id", ASCENDING)],
                    unique=True,
                    name="owner_player_unique",
                ),
                IndexModel(
                    [("owner_sub", ASCENDING)],
                    name="players_owner_lookup",
                ),
                IndexModel(
                    [("google_sub", ASCENDING)],
                    name="players_google_lookup",
                ),
                IndexModel(
                    [("linked_google_sub", ASCENDING)],
                    name="players_linked_lookup",
                ),
            ]
        )


async def ensure_player_indexes(database: AsyncIOMotorDatabase) -> None:
    """Ensure indexes exist for the players collection."""
    repository = PlayerRepository(database)
    await repository.ensure_indexes()
