"""Routers for managing playgroups."""

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..dependencies import get_mongo_database
from ..schemas import PlaygroupCreate, PlaygroupList, PlaygroupSummary
from ..services.play_data import list_playgroups, upsert_playgroup

router = APIRouter(prefix="/profiles/{google_sub}/playgroups", tags=["playgroups"])


@router.get(
    "",
    response_model=PlaygroupList,
    summary="List playgroups associated with the authenticated user.",
)
async def list_user_playgroups(
    google_sub: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlaygroupList:
    return await list_playgroups(database, google_sub)


@router.post(
    "",
    response_model=PlaygroupSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Create or update a playgroup for the authenticated user.",
)
async def create_or_update_playgroup(
    google_sub: str,
    payload: PlaygroupCreate,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlaygroupSummary:
    try:
        return await upsert_playgroup(database, google_sub, payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
