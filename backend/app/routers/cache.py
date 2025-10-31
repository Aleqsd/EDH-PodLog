"""Routers that expose cached payloads without hitting Moxfield."""

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import get_moxfield_cache_repository
from ..repositories import MoxfieldCacheRepository
from ..schemas import UserDeckSummariesResponse, UserDecksResponse
from ..services.storage import fetch_user_deck_summaries, fetch_user_decks

router = APIRouter(prefix="/cache", tags=["cache"])


@router.get(
    "/users/{username}/decks",
    response_model=UserDecksResponse,
    summary="Return cached deck data without calling Moxfield.",
)
async def get_cached_user_decks(
    username: str,
    repository: MoxfieldCacheRepository = Depends(get_moxfield_cache_repository),
) -> UserDecksResponse:
    payload = await fetch_user_decks(repository, username)
    if not payload:
        raise HTTPException(status_code=404, detail="No cached deck data for this user.")
    return payload


@router.get(
    "/users/{username}/deck-summaries",
    response_model=UserDeckSummariesResponse,
    summary="Return cached deck summaries without calling Moxfield.",
)
async def get_cached_user_deck_summaries(
    username: str,
    repository: MoxfieldCacheRepository = Depends(get_moxfield_cache_repository),
) -> UserDeckSummariesResponse:
    payload = await fetch_user_deck_summaries(repository, username)
    if not payload:
        raise HTTPException(
            status_code=404,
            detail="No cached deck summaries for this user.",
        )
    return payload
