"""Routers for profile management endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..dependencies import get_mongo_database
from ..schemas import (
    DeckPersonalization,
    DeckPersonalizationList,
    DeckPersonalizationUpdate,
    UserProfile,
    UserProfileUpdate,
)
from ..services.deck_personalization import (
    fetch_deck_personalization,
    fetch_deck_personalizations,
    upsert_deck_personalization,
)
from ..services.profiles import fetch_user_profile, upsert_user_profile
from ..logging_utils import get_logger

router = APIRouter(prefix="/profiles", tags=["profiles"])
logger = get_logger("profiles")


@router.get(
    "/{google_sub}",
    response_model=UserProfile,
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


@router.put(
    "/{google_sub}",
    response_model=UserProfile,
    summary="Create or update a Google-authenticated user profile.",
)
async def upsert_user_profile_endpoint(
    google_sub: str,
    payload: UserProfileUpdate,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> UserProfile:
    return await upsert_user_profile(database, google_sub, payload)


@router.get(
    "/{google_sub}/deck-personalizations",
    response_model=DeckPersonalizationList,
    summary="List all saved deck personalizations for the user.",
)
async def list_deck_personalizations(
    google_sub: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> DeckPersonalizationList:
    return await fetch_deck_personalizations(database, google_sub)


@router.get(
    "/{google_sub}/deck-personalizations/{deck_id:path}",
    response_model=DeckPersonalization,
    summary="Fetch personalization for a specific deck.",
)
async def get_deck_personalization_endpoint(
    google_sub: str,
    deck_id: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> DeckPersonalization:
    personalization = await fetch_deck_personalization(database, google_sub, deck_id)
    if not personalization:
        logger.info(
            "Deck personalization not found for user '%s' and deck '%s'.",
            google_sub,
            deck_id,
        )
        raise HTTPException(status_code=404, detail="Deck personalization not found.")
    return personalization


@router.put(
    "/{google_sub}/deck-personalizations/{deck_id:path}",
    response_model=DeckPersonalization,
    summary="Create or update personalization for a deck.",
)
async def upsert_deck_personalization_endpoint(
    google_sub: str,
    deck_id: str,
    payload: DeckPersonalizationUpdate,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> DeckPersonalization:
    logger.info(
        "Upserting deck personalization for user '%s' and deck '%s'.",
        google_sub,
        deck_id,
    )
    try:
        result = await upsert_deck_personalization(database, google_sub, deck_id, payload)
    except Exception:
        logger.exception(
            "Failed to upsert deck personalization for user '%s' and deck '%s'.",
            google_sub,
            deck_id,
        )
        raise
    return result
