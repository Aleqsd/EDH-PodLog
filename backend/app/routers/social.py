"""Routers exposing social discovery and follow features."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..dependencies import get_mongo_database
from ..schemas import (
    FollowList,
    FollowRequest,
    PublicUserProfile,
    UserSearchResponse,
)
from ..services.social import (
    follow_user,
    get_public_profile,
    list_following,
    search_public_profiles,
    unfollow_user,
)

router = APIRouter(prefix="/social", tags=["social"])


@router.get(
    "/users/search",
    response_model=UserSearchResponse,
    summary="Search public user profiles.",
)
async def search_users(
    q: str = Query("", alias="q"),
    viewer: str | None = Query(default=None),
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> UserSearchResponse:
    results = await search_public_profiles(database, q, viewer_sub=viewer)
    return UserSearchResponse(results=results)


@router.get(
    "/users/{google_sub}",
    response_model=PublicUserProfile,
    summary="Fetch a public user profile, including decks and recent games.",
)
async def fetch_public_user_profile(
    google_sub: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PublicUserProfile:
    try:
        return await get_public_profile(database, google_sub)
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.post(
    "/users/{follower_sub}/follow",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Follow another user.",
)
async def follow_user_profile(
    follower_sub: str,
    payload: FollowRequest,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> None:
    try:
        await follow_user(database, follower_sub, payload.target_sub)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@router.delete(
    "/users/{follower_sub}/follow/{target_sub}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unfollow a user.",
)
async def unfollow_user_profile(
    follower_sub: str,
    target_sub: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> None:
    await unfollow_user(database, follower_sub, target_sub)


@router.get(
    "/users/{follower_sub}/following",
    response_model=FollowList,
    summary="List users currently followed by the given account.",
)
async def list_following_profiles(
    follower_sub: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> FollowList:
    return await list_following(database, follower_sub)
