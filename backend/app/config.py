"""Runtime configuration helpers."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    """Application settings sourced from environment variables."""

    mongo_uri: str
    mongo_db: str
    mongo_users_collection: str
    mongo_decks_collection: str
    mongo_deck_summaries_collection: str
    cors_allow_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        """Construct settings using environment variables with sane defaults."""
        return cls(
            mongo_uri=os.getenv("MONGO_URI", "mongodb://127.0.0.1:47017"),
            mongo_db=os.getenv("MONGO_DB_NAME", "edh_podlog"),
            mongo_users_collection=os.getenv("MONGO_USERS_COLLECTION", "users"),
            mongo_decks_collection=os.getenv("MONGO_DECKS_COLLECTION", "decks"),
            mongo_deck_summaries_collection=os.getenv(
                "MONGO_DECK_SUMMARIES_COLLECTION", "deck_summaries"
            ),
            cors_allow_origins=_load_cors_origins(),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings.from_env()


def _load_cors_origins() -> tuple[str, ...]:
    """Return tuple of allowed CORS origins based on environment variables."""
    raw = os.getenv("API_CORS_ALLOW_ORIGINS")
    if raw:
        return tuple(origin.strip() for origin in raw.split(",") if origin.strip())
    # sensible defaults for local development frontends
    return ("http://localhost:3170", "http://127.0.0.1:3170")
