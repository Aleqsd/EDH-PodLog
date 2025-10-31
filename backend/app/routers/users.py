"""Routers for user and deck interactions."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..dependencies import get_moxfield_cache_repository, get_moxfield_client
from ..logging_utils import get_logger
from ..moxfield import MoxfieldClient, MoxfieldError, MoxfieldNotFoundError
from ..repositories import MoxfieldCacheRepository
from ..schemas import UserDeckSummariesResponse, UserDecksResponse
from ..services.moxfield import build_user_deck_summaries_response, build_user_decks_response
from ..services.storage import (
    delete_user_deck,
    upsert_user_deck_summaries,
    upsert_user_decks,
)

logger = get_logger("backend")

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/{username}/deck-summaries",
    response_model=UserDeckSummariesResponse,
    summary="Fetch a user's decks without card details.",
)
async def get_user_deck_summaries(
    username: str,
    client: MoxfieldClient = Depends(get_moxfield_client),
    repository: MoxfieldCacheRepository = Depends(get_moxfield_cache_repository),
) -> UserDeckSummariesResponse:
    try:
        response = await build_user_deck_summaries_response(client, username)
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

    await _try_upsert(upsert_user_deck_summaries, repository, response)
    return response


@router.get(
    "/{username}/decks",
    response_model=UserDecksResponse,
    summary="Fetch a user's decks including full card details.",
)
async def get_user_decks(
    username: str,
    client: MoxfieldClient = Depends(get_moxfield_client),
    repository: MoxfieldCacheRepository = Depends(get_moxfield_cache_repository),
) -> UserDecksResponse:
    try:
        response = await build_user_decks_response(client, username)
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

    await _try_upsert(upsert_user_decks, repository, response)
    return response


@router.delete(
    "/{username}/decks/{deck_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a cached deck for a user.",
)
async def delete_user_deck_endpoint(
    username: str,
    deck_id: str,
    repository: MoxfieldCacheRepository = Depends(get_moxfield_cache_repository),
) -> Response:
    deleted = await delete_user_deck(repository, username, deck_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Deck not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _try_upsert(
    func: Callable[[MoxfieldCacheRepository, Any], Awaitable[None]],
    repository: MoxfieldCacheRepository,
    payload: UserDeckSummariesResponse | UserDecksResponse,
) -> None:
    """Persist payloads to MongoDB without disrupting the response path."""
    try:
        await func(repository, payload)
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
