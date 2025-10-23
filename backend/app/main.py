"""Entry point for the Moxfield scraping API server."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorDatabase

from .dependencies import close_mongo_client, get_mongo_database, get_moxfield_client
from .moxfield import MoxfieldClient, MoxfieldError, MoxfieldNotFoundError
from .schemas import (
    UserDeckSummariesResponse,
    UserDecksResponse,
    UserProfile,
    UserProfileUpdate,
)
from .logging_utils import get_logger
from .services.moxfield import build_user_deck_summaries_response, build_user_decks_response
from .services.profiles import fetch_user_profile, upsert_user_profile
from .services.storage import (
    delete_user_deck,
    fetch_user_deck_summaries,
    fetch_user_decks,
    upsert_user_deck_summaries,
    upsert_user_decks,
)
from .config import get_settings

logger = get_logger("backend")


def create_app() -> FastAPI:
    """Instantiate and configure the FastAPI application."""
    app = FastAPI(
        title="Moxfield Scraping API",
        version="0.1.0",
        description="Simple proxy API that fetches public Moxfield data.",
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

    @app.on_event("shutdown")
    async def shutdown_event() -> None:
        """Ensure connections are closed cleanly."""
        close_mongo_client()

    @app.get("/health", tags=["meta"])
    async def health_check() -> dict[str, str]:
        """Useful for uptime checks."""
        return {"status": "ok"}

    @app.get(
        "/profiles/{google_sub}",
        response_model=UserProfile,
        tags=["profiles"],
        summary="Fetch a Google-authenticated user profile.",
    )
    async def get_user_profile(
        google_sub: str,
        database: AsyncIOMotorDatabase = Depends(get_mongo_database),
    ) -> UserProfile:
        profile = await fetch_user_profile(database, google_sub)
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found.")
        return profile

    @app.put(
        "/profiles/{google_sub}",
        response_model=UserProfile,
        tags=["profiles"],
        summary="Create or update a Google-authenticated user profile.",
    )
    async def upsert_user_profile_endpoint(
        google_sub: str,
        payload: UserProfileUpdate,
        database: AsyncIOMotorDatabase = Depends(get_mongo_database),
    ) -> UserProfile:
        return await upsert_user_profile(database, google_sub, payload)

    @app.get(
        "/users/{username}/deck-summaries",
        response_model=UserDeckSummariesResponse,
        tags=["users"],
        summary="Fetch a user's decks without card details.",
    )
    async def get_user_deck_summaries(
        username: str,
        client: MoxfieldClient = Depends(get_moxfield_client),
        database: AsyncIOMotorDatabase = Depends(get_mongo_database),
    ) -> UserDeckSummariesResponse:
        try:
            response = await run_in_threadpool(
                build_user_deck_summaries_response,
                client,
                username,
            )
            logger.info(
                "Deck summary sync succeeded for user '%s' with %d deck summaries.",
                username,
                len(response.decks),
            )
        except MoxfieldNotFoundError as exc:
            logger.info(
                "Deck summary sync skipped because user '%s' was not found on Moxfield.",
                username,
            )
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except MoxfieldError as exc:
            logger.warning(
                "Deck summary sync failed for user '%s' due to upstream error: %s",
                username,
                exc,
            )
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        await _try_upsert(upsert_user_deck_summaries, database, response)
        return response

    @app.get(
        "/users/{username}/decks",
        response_model=UserDecksResponse,
        tags=["users"],
        summary="Fetch a user's decks including full card details.",
    )
    async def get_user_decks(
        username: str,
        client: MoxfieldClient = Depends(get_moxfield_client),
        database: AsyncIOMotorDatabase = Depends(get_mongo_database),
    ) -> UserDecksResponse:
        try:
            response = await run_in_threadpool(build_user_decks_response, client, username)
            logger.info(
                "Deck sync succeeded for user '%s' with %d deck(s).",
                username,
                len(response.decks),
            )
        except MoxfieldNotFoundError as exc:
            logger.info(
                "Deck sync skipped because user '%s' was not found on Moxfield.",
                username,
            )
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except MoxfieldError as exc:
            logger.warning(
                "Deck sync failed for user '%s' due to upstream error: %s",
                username,
                exc,
            )
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        await _try_upsert(upsert_user_decks, database, response)
        return response

    @app.get(
        "/cache/users/{username}/decks",
        response_model=UserDecksResponse,
        tags=["cache"],
        summary="Return cached deck data without calling Moxfield.",
    )
    async def get_cached_user_decks(
        username: str,
        database: AsyncIOMotorDatabase = Depends(get_mongo_database),
    ) -> UserDecksResponse:
        payload = await fetch_user_decks(database, username)
        if not payload:
            raise HTTPException(status_code=404, detail="No cached deck data for this user.")
        return payload

    @app.get(
        "/cache/users/{username}/deck-summaries",
        response_model=UserDeckSummariesResponse,
        tags=["cache"],
        summary="Return cached deck summaries without calling Moxfield.",
    )
    async def get_cached_user_deck_summaries(
        username: str,
        database: AsyncIOMotorDatabase = Depends(get_mongo_database),
    ) -> UserDeckSummariesResponse:
        payload = await fetch_user_deck_summaries(database, username)
        if not payload:
            raise HTTPException(status_code=404, detail="No cached deck summaries for this user.")
        return payload

    @app.delete(
        "/users/{username}/decks/{deck_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["users"],
        summary="Delete a cached deck for a user.",
    )
    async def delete_user_deck_endpoint(
        username: str,
        deck_id: str,
        database: AsyncIOMotorDatabase = Depends(get_mongo_database),
    ) -> Response:
        deleted = await delete_user_deck(database, username, deck_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Deck not found.")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return app


app = create_app()


async def _try_upsert(
    func: Callable[[AsyncIOMotorDatabase, Any], Awaitable[None]],
    database: AsyncIOMotorDatabase,
    payload: UserDeckSummariesResponse | UserDecksResponse,
) -> None:
    """Persist payloads to MongoDB without disrupting the response path."""
    try:
        await func(database, payload)
    except Exception:  # pragma: no cover - defensive logging
        logger.exception(
            "Deck persistence failed for user '%s' with %d item(s).",
            payload.user.user_name,
            len(payload.decks),
        )
    else:
        logger.info(
            "Deck persistence completed for user '%s' with %d item(s).",
            payload.user.user_name,
            len(payload.decks),
        )
