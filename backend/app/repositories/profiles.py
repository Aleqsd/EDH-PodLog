"""MongoDB helpers for user profile indexes."""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, IndexModel, TEXT

from ..config import get_settings
from ..logging_utils import get_logger

logger = get_logger("repositories.profiles")


async def ensure_user_profile_indexes(database: AsyncIOMotorDatabase) -> None:
    """Ensure indexes exist for efficient user profile lookups."""
    settings = get_settings()
    collection = database[settings.mongo_users_collection]

    logger.info("Ensuring Mongo indexes for user profiles collection.")
    await collection.create_indexes(
        [
            IndexModel([("google_sub", ASCENDING)], name="profile_google_sub_idx"),
            IndexModel([("is_public", ASCENDING), ("display_name", ASCENDING)], name="profile_public_display_idx"),
            IndexModel([("is_public", ASCENDING), ("email", ASCENDING)], name="profile_public_email_idx"),
            IndexModel(
                [("display_name", TEXT), ("given_name", TEXT), ("email", TEXT), ("description", TEXT)],
                name="profile_search_text_idx",
            ),
        ]
    )
