"""Routers for managing tracked players and participant lists."""

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..dependencies import get_mongo_database
from ..schemas import PlayerCreate, PlayerLinkRequest, PlayerList, PlayerSummary, PlayerUpdate
from ..services.players import (
    create_tracked_player,
    delete_tracked_player,
    link_tracked_player,
    list_available_players,
    list_tracked_players,
    update_tracked_player,
)

router = APIRouter(prefix="/profiles/{google_sub}/players", tags=["players"])


@router.get(
    "",
    response_model=PlayerList,
    summary="List tracked (guest) players created by the user.",
)
async def list_user_players(
    google_sub: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlayerList:
    return await list_tracked_players(database, google_sub)


@router.post(
    "",
    response_model=PlayerSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Create a tracked player entry.",
)
async def create_user_player(
    google_sub: str,
    payload: PlayerCreate,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlayerSummary:
    try:
        return await create_tracked_player(database, google_sub, payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@router.put(
    "/{player_id}",
    response_model=PlayerSummary,
    summary="Update a tracked player entry.",
)
async def update_user_player(
    google_sub: str,
    player_id: str,
    payload: PlayerUpdate,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlayerSummary:
    try:
        return await update_tracked_player(database, google_sub, player_id, payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.delete(
    "/{player_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a tracked player entry.",
)
async def delete_user_player(
    google_sub: str,
    player_id: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> None:
    try:
        await delete_tracked_player(database, google_sub, player_id)
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.post(
    "/{player_id}/link",
    response_model=PlayerSummary,
    summary="Link a tracked player to a registered user.",
)
async def link_user_player(
    google_sub: str,
    player_id: str,
    payload: PlayerLinkRequest,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlayerSummary:
    try:
        return await link_tracked_player(database, google_sub, player_id, payload)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.get(
    "/available",
    response_model=PlayerList,
    summary="List all players available to the user when composing a game.",
)
async def list_available_user_players(
    google_sub: str,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> PlayerList:
    return await list_available_players(database, google_sub)
