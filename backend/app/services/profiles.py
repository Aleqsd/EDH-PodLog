"""MongoDB helpers for Google-authenticated user profiles."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..config import get_settings
from ..schemas import UserProfile, UserProfileUpdate


async def fetch_user_profile(
    database: AsyncIOMotorDatabase, google_sub: str
) -> UserProfile | None:
    """Return the persisted profile for the given Google subject identifier."""
    settings = get_settings()
    profiles = database[settings.mongo_users_collection]
    document = await profiles.find_one({"google_sub": google_sub})
    if not document:
        return None
    return UserProfile.model_validate(_strip_profile_storage_fields(document))


async def upsert_user_profile(
    database: AsyncIOMotorDatabase, google_sub: str, payload: UserProfileUpdate
) -> UserProfile:
    """Create or update a user profile record."""
    settings = get_settings()
    profiles = database[settings.mongo_users_collection]
    existing = await profiles.find_one({"google_sub": google_sub})

    now = datetime.now(timezone.utc)
    update_fields = payload.model_dump(mode="python", exclude_unset=True)
    if "moxfield_decks" in update_fields and update_fields["moxfield_decks"] is None:
        update_fields["moxfield_decks"] = []
    if "display_name" in update_fields:
        display_name = update_fields["display_name"]
        if isinstance(display_name, str):
            normalized_display_name = display_name.strip()
            update_fields["display_name"] = normalized_display_name or None
        else:
            update_fields["display_name"] = None
    if "description" in update_fields:
        description = update_fields["description"]
        if isinstance(description, str):
            normalized_description = description.strip()
            update_fields["description"] = normalized_description or None
        else:
            update_fields["description"] = None
    if "picture" in update_fields:
        picture = update_fields["picture"]
        if isinstance(picture, str):
            normalized_picture = picture.strip()
            update_fields["picture"] = normalized_picture or None
        elif picture is None:
            update_fields["picture"] = None

    base_document: dict[str, Any]
    if existing:
        base_document = _strip_profile_storage_fields(existing)
    else:
        base_document = {
            "google_sub": google_sub,
            "created_at": now,
            "moxfield_decks": [],
            "is_public": False,
        }

    merged = {**base_document, **update_fields}
    merged["google_sub"] = google_sub
    merged.setdefault("created_at", now)
    merged.setdefault("moxfield_decks", [])
    merged.setdefault("is_public", False)
    merged["updated_at"] = now

    await profiles.update_one(
        {"google_sub": google_sub},
        {"$set": merged},
        upsert=True,
    )

    stored = await profiles.find_one({"google_sub": google_sub})
    if not stored:
        raise RuntimeError("Failed to persist user profile.")
    return UserProfile.model_validate(_strip_profile_storage_fields(stored))


def _strip_profile_storage_fields(document: dict[str, Any]) -> dict[str, Any]:
    """Drop Mongo-specific fields before validating with Pydantic."""
    clean_doc = dict(document)
    clean_doc.pop("_id", None)
    return clean_doc
