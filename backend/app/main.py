"""Entry point for the Moxfield scraping API server."""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .dependencies import close_mongo_client, get_mongo_database
from .logging_utils import get_logger
from .repositories import (
    ensure_deck_personalization_indexes,
    ensure_follow_indexes,
    ensure_moxfield_cache_indexes,
    ensure_play_data_indexes,
    ensure_player_indexes,
    ensure_user_profile_indexes,
)
from .routers import (
    cache_router,
    games_router,
    meta_router,
    players_router,
    playgroups_router,
    profiles_router,
    social_router,
    users_router,
)

logger = get_logger("backend")


def create_app() -> FastAPI:
    """Instantiate and configure the FastAPI application."""

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        """Manage startup/shutdown work without relying on deprecated hooks."""
        database = get_mongo_database()
        try:
            await ensure_moxfield_cache_indexes(database)
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to ensure Mongo indexes during startup.")
        try:
            await ensure_play_data_indexes(database)
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to ensure play data indexes during startup.")
        try:
            await ensure_deck_personalization_indexes(database)
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to ensure personalization indexes during startup.")
        try:
            await ensure_player_indexes(database)
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to ensure player indexes during startup.")
        try:
            await ensure_follow_indexes(database)
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to ensure follow indexes during startup.")
        try:
            await ensure_user_profile_indexes(database)
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to ensure user profile indexes during startup.")
        try:
            yield
        finally:
            close_mongo_client()

    app = FastAPI(
        title="Moxfield Scraping API",
        version="0.1.0",
        description="Simple proxy API that fetches public Moxfield data.",
        lifespan=lifespan,
    )

    settings = get_settings()
    allow_origins = list(settings.cors_allow_origins)
    allow_credentials = True
    if not allow_origins:
        allow_origins = ["*"]
        allow_credentials = False
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(meta_router)
    app.include_router(playgroups_router)
    app.include_router(games_router)
    app.include_router(profiles_router)
    app.include_router(players_router)
    app.include_router(social_router)
    app.include_router(users_router)
    app.include_router(cache_router)

    return app


app = create_app()
