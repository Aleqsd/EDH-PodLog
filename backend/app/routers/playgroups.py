"""Routers for managing playgroups."""

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..dependencies import get_mongo_database
from ..schemas import PlaygroupCreate, PlaygroupDetail, PlaygroupList, PlaygroupSummary, PlaygroupUpdate
from ..services.play_data import (
    delete_playgroup,
    get_playgroup_detail,
    list_playgroups,
    update_playgroup,
    upsert_playgroup,
)

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


@router.get(
    "/{playgroup_id}",
    response_model=PlaygroupDetail,
    summary="Fetch a playgroup with members, history, and statistics.",
)
async def get_user_playgroup_detail(
    google_sub: str,
    playgroup_id: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlaygroupDetail:
    try:
        return await get_playgroup_detail(database, google_sub, playgroup_id)
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.put(
    "/{playgroup_id}",
    response_model=PlaygroupSummary,
    summary="Update playgroup metadata and membership.",
)
async def update_user_playgroup(
    google_sub: str,
    playgroup_id: str,
    payload: PlaygroupUpdate,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlaygroupSummary:
    try:
        return await update_playgroup(database, google_sub, playgroup_id, payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.delete(
    "/{playgroup_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a playgroup.",
)
async def delete_user_playgroup(
    google_sub: str,
    playgroup_id: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> None:
    try:
        await delete_playgroup(database, google_sub, playgroup_id)
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
