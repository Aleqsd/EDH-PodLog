"""Domain services for playgroups and recorded games."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, List
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..logging_utils import get_logger
from ..repositories import GameRepository, PlaygroupRepository
from ..schemas import (
    GameCreate,
    GameList,
    GamePlaygroup,
    GameRecord,
    GameRanking,
    GameRankingInput,
    GamePlayer,
    GamePlayerInput,
    PlaygroupCreate,
    PlaygroupList,
    PlaygroupReference,
    PlaygroupSummary,
)

logger = get_logger("services.play_data")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _trim(value: str | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _clean_playgroup_payload(payload: PlaygroupCreate | PlaygroupReference) -> PlaygroupCreate:
    name = _trim(payload.name)
    if not name:
        raise ValueError("Le nom du groupe est obligatoire.")
    return PlaygroupCreate(name=name)


def _clean_player_payload(players: Iterable[GamePlayerInput]) -> List[GamePlayer]:
    cleaned: List[GamePlayer] = []
    for index, player in enumerate(players):
        name = _trim(player.name)
        if not name:
            raise ValueError("Chaque joueur doit avoir un nom.")

        player_id = player.id or uuid4().hex
        cleaned.append(
            GamePlayer(
                id=player_id,
                name=name,
                is_owner=bool(player.is_owner),
                deck_id=_trim(player.deck_id) or None,
                deck_name=_trim(player.deck_name) or None,
                deck_format=_trim(player.deck_format) or None,
                deck_slug=_trim(player.deck_slug) or None,
                deck_public_url=_trim(player.deck_public_url) or None,
                order=player.order if isinstance(player.order, int) else index,
            )
        )
    if not cleaned:
        raise ValueError("Au moins un joueur est requis.")
    return cleaned


def _clean_rankings(rankings: Iterable[GameRankingInput], player_ids: Iterable[str]) -> List[GameRanking]:
    id_set = set(player_ids)
    seen_ids: set[str] = set()
    cleaned: List[GameRanking] = []

    for ranking in rankings:
        if ranking.player_id not in id_set:
            raise ValueError("Les classements doivent référencer des joueurs existants.")
        if ranking.player_id in seen_ids:
            raise ValueError("Chaque joueur ne peut être classé qu'une seule fois.")
        seen_ids.add(ranking.player_id)
        cleaned.append(GameRanking(player_id=ranking.player_id, rank=int(ranking.rank)))

    if len(cleaned) != len(id_set):
        raise ValueError("Chaque joueur doit posséder un rang.")

    cleaned.sort(key=lambda entry: (entry.rank, entry.player_id))
    return cleaned


def _map_playgroup_summary(document: dict) -> PlaygroupSummary:
    data = {
        "id": document["id"],
        "name": document.get("name", ""),
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
        "last_used_at": document.get("last_used_at"),
        "game_count": int(document.get("game_count", 0)),
    }
    return PlaygroupSummary(**data)


def _map_game_record(document: dict) -> GameRecord:
    playgroup = GamePlaygroup(id=document["playgroup_id"], name=document.get("playgroup_name", ""))
    players = [
        GamePlayer(
            id=player["id"],
            name=player.get("name", ""),
            is_owner=bool(player.get("is_owner", False)),
            deck_id=player.get("deck_id"),
            deck_name=player.get("deck_name"),
            deck_format=player.get("deck_format"),
            deck_slug=player.get("deck_slug"),
            deck_public_url=player.get("deck_public_url"),
            order=player.get("order"),
        )
        for player in document.get("players", [])
    ]
    players.sort(key=lambda entry: entry.order if entry.order is not None else 0)

    rankings = [
        GameRanking(player_id=ranking.get("player_id"), rank=int(ranking.get("rank", 0)))
        for ranking in document.get("rankings", [])
    ]
    rankings.sort(key=lambda entry: (entry.rank, entry.player_id))

    return GameRecord(
        id=document["id"],
        playgroup=playgroup,
        created_at=document.get("created_at"),
        updated_at=document.get("updated_at"),
        players=players,
        rankings=rankings,
        notes=document.get("notes"),
    )


async def list_playgroups(database: AsyncIOMotorDatabase, owner_sub: str) -> PlaygroupList:
    repository = PlaygroupRepository(database)
    documents = await repository.list_for_owner(owner_sub)
    summaries = [_map_playgroup_summary(doc) for doc in documents]
    return PlaygroupList(playgroups=summaries)


async def upsert_playgroup(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    payload: PlaygroupCreate,
) -> PlaygroupSummary:
    repository = PlaygroupRepository(database)
    cleaned = _clean_playgroup_payload(payload)
    document = await repository.upsert(owner_sub, cleaned.name)
    return _map_playgroup_summary(document)


async def resolve_playgroup(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    reference: PlaygroupReference,
) -> dict:
    repository = PlaygroupRepository(database)
    cleaned = _clean_playgroup_payload(reference)

    if reference.id:
        document = await repository.find_by_id(owner_sub, reference.id)
        if not document:
            raise LookupError("Groupe introuvable.")
        if document.get("name") != cleaned.name:
            document = await repository.touch(
                owner_sub,
                document["id"],
                name=cleaned.name,
            )
        return document

    return await repository.upsert(owner_sub, cleaned.name)


async def record_game(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    payload: GameCreate,
) -> GameRecord:
    playgroups = PlaygroupRepository(database)
    games = GameRepository(database)

    resolved_playgroup = await resolve_playgroup(database, owner_sub, payload.playgroup)
    players = _clean_player_payload(payload.players)

    if len(players) < 2:
        raise ValueError("Au moins deux joueurs sont requis pour enregistrer une partie.")

    rankings = _clean_rankings(payload.rankings, (player.id for player in players))

    recorded_at = payload.recorded_at or _now()
    notes = _trim(payload.notes) or None

    document = {
        "id": uuid4().hex,
        "owner_sub": owner_sub,
        "playgroup_id": resolved_playgroup["id"],
        "playgroup_name": resolved_playgroup.get("name", ""),
        "created_at": recorded_at,
        "updated_at": recorded_at,
        "players": [player.model_dump() for player in players],
        "rankings": [ranking.model_dump() for ranking in rankings],
        "notes": notes,
    }

    await games.save(document)

    game_count = int(resolved_playgroup.get("game_count", 0)) + 1
    updated_playgroup = await playgroups.touch(
        owner_sub,
        resolved_playgroup["id"],
        last_used_at=recorded_at,
        game_count=game_count,
        name=resolved_playgroup.get("name"),
    )
    if updated_playgroup:
        document["playgroup_name"] = updated_playgroup.get("name", document["playgroup_name"])

    logger.info(
        "Recorded game '%s' for owner '%s' in playgroup '%s'",
        document["id"],
        owner_sub,
        document["playgroup_id"],
    )

    return _map_game_record(document)


async def list_games(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    *,
    playgroup_id: str | None = None,
) -> GameList:
    repository = GameRepository(database)
    documents = await repository.list_for_owner(owner_sub, playgroup_id=playgroup_id)
    records = [_map_game_record(document) for document in documents]
    return GameList(games=records)
