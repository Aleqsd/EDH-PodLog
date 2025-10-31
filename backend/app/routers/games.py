"""Routers for recording and listing game results."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..dependencies import get_mongo_database
from ..schemas import GameCreate, GameList, GameRecord
from ..services.play_data import list_games, record_game

router = APIRouter(prefix="/profiles/{google_sub}/games", tags=["games"])


@router.get(
    "",
    response_model=GameList,
    summary="List recorded games for the authenticated user.",
)
async def list_user_games(
    google_sub: str,
    playgroup_id: str | None = Query(default=None, description="Filter games by playgroup identifier."),
    limit: int | None = Query(
        default=None,
        ge=1,
        le=500,
        description="Optional cap on the number of games to return, sorted by most recent first.",
    ),
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> GameList:
    return await list_games(database, google_sub, playgroup_id=playgroup_id, limit=limit)


@router.post(
    "",
    response_model=GameRecord,
    status_code=status.HTTP_201_CREATED,
    summary="Record a completed game for the authenticated user.",
)
async def create_user_game(
    google_sub: str,
    payload: GameCreate,
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> GameRecord:
    try:
        return await record_game(database, google_sub, payload)
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
