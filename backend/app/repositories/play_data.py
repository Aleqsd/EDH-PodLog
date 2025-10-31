"""MongoDB repository helpers for playgroups and recorded games."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import uuid4

import re
import unicodedata

from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, IndexModel

from ..config import get_settings
from ..logging_utils import get_logger

logger = get_logger("repositories.play_data")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _strip_storage_fields(document: dict[str, Any]) -> dict[str, Any]:
    clean = dict(document)
    clean.pop("_id", None)
    return clean


class PlaygroupRepository:
    """Encapsulates Mongo persistence for user playgroups."""

    _slug_pattern = re.compile(r"[^a-z0-9]+")

    def __init__(self, database: AsyncIOMotorDatabase) -> None:
        settings = get_settings()
        self._collection: AsyncIOMotorCollection = database[settings.mongo_playgroups_collection]

    @staticmethod
    def _normalize_name(name: str) -> str:
        return " ".join(name.strip().split())

    @classmethod
    def _slugify(cls, name: str) -> str:
        normalized = unicodedata.normalize("NFKD", name or "")
        ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
        slug = cls._slug_pattern.sub("-", ascii_name.lower()).strip("-")
        return slug or uuid4().hex

    def owner_filter(self, owner_sub: str) -> dict[str, Any]:
        return {"owner_sub": owner_sub}

    def id_filter(self, owner_sub: str, playgroup_id: str) -> dict[str, Any]:
        return {"owner_sub": owner_sub, "id": playgroup_id}

    async def find_by_id(self, owner_sub: str, playgroup_id: str) -> dict[str, Any] | None:
        document = await self._collection.find_one(self.id_filter(owner_sub, playgroup_id))
        return _strip_storage_fields(document) if document else None

    async def find_by_slug(self, owner_sub: str, slug: str) -> dict[str, Any] | None:
        document = await self._collection.find_one({"owner_sub": owner_sub, "slug": slug})
        return _strip_storage_fields(document) if document else None

    async def list_for_owner(self, owner_sub: str) -> list[dict[str, Any]]:
        cursor = self._collection.find(self.owner_filter(owner_sub))
        documents = await cursor.to_list(length=None)
        clean = [_strip_storage_fields(document) for document in documents]
        clean.sort(
            key=lambda doc: (
                doc.get("last_used_at") or datetime.min.replace(tzinfo=timezone.utc),
                doc.get("updated_at") or datetime.min.replace(tzinfo=timezone.utc),
            ),
            reverse=True,
        )
        return clean

    async def upsert(
        self,
        owner_sub: str,
        name: str,
        *,
        members: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Create or update a playgroup with the given name for an owner."""
        safe_name = self._normalize_name(name)
        slug = self._slugify(safe_name)
        now = _now()

        document = await self.find_by_slug(owner_sub, slug)
        if document:
            updates = {
                "name": safe_name,
                "slug": slug,
                "updated_at": now,
            }
            if members is not None:
                updates["members"] = members
            await self._collection.update_one(
                self.id_filter(owner_sub, document["id"]),
                {"$set": updates},
                upsert=True,
            )
            document.update(updates)
            return document

        playgroup_id = uuid4().hex
        new_document = {
            "id": playgroup_id,
            "owner_sub": owner_sub,
            "name": safe_name,
            "slug": slug,
            "created_at": now,
            "updated_at": now,
            "last_used_at": now,
            "game_count": 0,
            "members": members or [],
        }
        await self._collection.update_one(
            self.id_filter(owner_sub, playgroup_id),
            {"$set": new_document},
            upsert=True,
        )
        return new_document

    async def save(self, document: dict[str, Any]) -> dict[str, Any]:
        if "id" not in document or "owner_sub" not in document:
            raise ValueError("Playgroup documents must include 'id' and 'owner_sub'.")
        await self._collection.update_one(
            self.id_filter(document["owner_sub"], document["id"]),
            {"$set": document},
            upsert=True,
        )
        return document

    async def touch(
        self,
        owner_sub: str,
        playgroup_id: str,
        *,
        last_used_at: datetime | None = None,
        game_count: int | None = None,
        name: str | None = None,
    ) -> dict[str, Any] | None:
        """Update playgroup metadata when recording a game."""
        document = await self.find_by_id(owner_sub, playgroup_id)
        if not document:
            return None

        updates: dict[str, Any] = {"updated_at": _now()}
        if last_used_at:
            updates["last_used_at"] = last_used_at
        if game_count is not None:
            updates["game_count"] = max(game_count, 0)
        if name:
            safe_name = self._normalize_name(name)
            updates["name"] = safe_name
            updates["slug"] = self._slugify(safe_name)

        document.update(updates)
        await self._collection.update_one(
            self.id_filter(owner_sub, playgroup_id),
            {"$set": document},
            upsert=True,
        )
        return document

    async def delete(self, owner_sub: str, playgroup_id: str) -> bool:
        result = await self._collection.delete_one(self.id_filter(owner_sub, playgroup_id))
        return getattr(result, "deleted_count", 0) > 0

    async def ensure_indexes(self) -> None:
        logger.info("Ensuring Mongo indexes for playgroups collection.")
        await self._collection.create_indexes(
            [
                IndexModel([("owner_sub", ASCENDING), ("slug", ASCENDING)], unique=True, name="owner_slug_unique"),
                IndexModel([("owner_sub", ASCENDING)], name="playgroups_owner_lookup"),
                IndexModel([("last_used_at", ASCENDING)], name="playgroups_last_used"),
            ]
        )


class GameRepository:
    """Encapsulates Mongo persistence for recorded games."""

    def __init__(self, database: AsyncIOMotorDatabase) -> None:
        settings = get_settings()
        self._collection: AsyncIOMotorCollection = database[settings.mongo_games_collection]

    def owner_filter(self, owner_sub: str) -> dict[str, Any]:
        return {"owner_sub": owner_sub}

    def id_filter(self, owner_sub: str, game_id: str) -> dict[str, Any]:
        return {"owner_sub": owner_sub, "id": game_id}

    async def save(self, document: dict[str, Any]) -> dict[str, Any]:
        if "id" not in document or "owner_sub" not in document:
            raise ValueError("Game documents must include 'id' and 'owner_sub'.")
        await self._collection.update_one(
            self.id_filter(document["owner_sub"], document["id"]),
            {"$set": document},
            upsert=True,
        )
        return document

    async def list_for_owner(
        self,
        owner_sub: str,
        *,
        playgroup_id: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        filter_ = self.owner_filter(owner_sub)
        if playgroup_id:
            filter_["playgroup_id"] = playgroup_id

        projection = {"_id": 0}
        cursor = self._collection.find(filter_, projection).sort(
            [("created_at", DESCENDING), ("updated_at", DESCENDING)]
        )
        if limit is not None and limit > 0:
            cursor = cursor.limit(limit)

        documents = await cursor.to_list(length=None)
        return [_strip_storage_fields(document) for document in documents]

    async def ensure_indexes(self) -> None:
        logger.info("Ensuring Mongo indexes for games collection.")
        await self._collection.create_indexes(
            [
                IndexModel([("owner_sub", ASCENDING), ("id", ASCENDING)], unique=True, name="owner_game_unique"),
                IndexModel([("owner_sub", ASCENDING), ("created_at", ASCENDING)], name="games_owner_created"),
                IndexModel([("playgroup_id", ASCENDING)], name="games_playgroup_lookup"),
            ]
        )

    async def update_player_identity(
        self,
        owner_sub: str,
        player_id: str,
        *,
        google_sub: str | None = None,
        player_type: str | None = None,
        name: str | None = None,
    ) -> int:
        """Update stored games when a player's identity changes."""
        cursor = self._collection.find(self.owner_filter(owner_sub))
        documents = await cursor.to_list(length=None)
        updated = 0
        now = _now()

        for document in documents:
            players = document.get("players", [])
            changed = False
            for entry in players:
                if entry.get("id") != player_id:
                    continue
                if google_sub is not None:
                    entry["google_sub"] = google_sub
                    entry["linked_google_sub"] = google_sub
                if player_type is not None:
                    entry["player_type"] = player_type
                if name is not None:
                    entry["name"] = name
                changed = True

            if not changed:
                continue

            document["players"] = players
            document["updated_at"] = now
            await self._collection.update_one(
                self.id_filter(owner_sub, document["id"]),
                {"$set": document},
                upsert=True,
            )
            updated += 1

        return updated


async def ensure_play_data_indexes(database: AsyncIOMotorDatabase) -> None:
    """Ensure Mongo indexes exist for playgroup and game collections."""
    playgroups = PlaygroupRepository(database)
    games = GameRepository(database)
    await playgroups.ensure_indexes()
    await games.ensure_indexes()
