"""Routers for profile management endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..dependencies import get_mongo_database
from ..schemas import UserProfile, UserProfileUpdate
from ..services.profiles import fetch_user_profile, upsert_user_profile

router = APIRouter(prefix="/profiles", tags=["profiles"])


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
