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
    DeckPerformanceSummary,
    PlayerPerformanceSummary,
    PlayerType,
    PlaygroupCreate,
    PlaygroupDetail,
    PlaygroupList,
    PlaygroupMember,
    PlaygroupMemberUpdate,
    PlaygroupReference,
    PlaygroupStats,
    PlaygroupSummary,
    PlaygroupUpdate,
)

logger = get_logger("services.play_data")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _trim(value: str | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _clean_playgroup_name(name: str) -> str:
    value = _trim(name)
    if not value:
        raise ValueError("Le nom du groupe est obligatoire.")
    return value


def _clean_members_payload(
    members: Iterable[PlaygroupMemberUpdate] | None,
    *,
    existing: list[dict] | None = None,
) -> list[dict]:
    existing_lookup: dict[tuple[str, str], dict] = {}
    if existing:
        for entry in existing:
            player_type = entry.get("player_type") or PlayerType.GUEST.value
            identifier = entry.get("google_sub") or entry.get("player_id")
            if not identifier:
                continue
            existing_lookup[(player_type, identifier)] = entry

    cleaned: list[dict] = []
    if not members:
        return cleaned

    seen: set[tuple[str, str]] = set()
    for member in members:
        player_type = member.player_type or PlayerType.GUEST
        google_sub = _trim(member.google_sub)
        player_id = _trim(member.player_id)
        name = _trim(member.name)

        if player_type == PlayerType.USER:
            if not google_sub:
                raise ValueError("Les membres liés à un compte doivent fournir un identifiant utilisateur.")
            identifier = google_sub
        else:
            if not player_id:
                player_id = uuid4().hex
            if not name:
                raise ValueError("Les joueurs invités doivent avoir un nom.")
            identifier = player_id

        key = (player_type.value, identifier)
        if key in seen:
            continue
        seen.add(key)

        base = existing_lookup.get(key, {})
        cleaned.append(
            {
                "player_type": player_type.value,
                "player_id": player_id or None,
                "google_sub": google_sub or None,
                "name": name or base.get("name"),
                "added_at": base.get("added_at") or _now(),
            }
        )

    return cleaned


def _clean_playgroup_payload(payload: PlaygroupCreate | PlaygroupReference) -> PlaygroupCreate:
    name = _clean_playgroup_name(payload.name)
    if not name:
        raise ValueError("Le nom du groupe est obligatoire.")
    members = payload.members if isinstance(payload, PlaygroupCreate) else None
    return PlaygroupCreate(name=name, members=members)


def _clean_player_payload(
    players: Iterable[GamePlayerInput],
    owner_sub: str,
) -> List[GamePlayer]:
    cleaned: List[GamePlayer] = []
    for index, player in enumerate(players):
        name = _trim(player.name)
        if not name:
            raise ValueError("Chaque joueur doit avoir un nom.")

        player_id = player.id or uuid4().hex
        google_sub = _trim(player.google_sub)
        linked_google_sub = _trim(player.linked_google_sub) or None
        if player.is_owner and not google_sub:
            google_sub = owner_sub
        player_type = player.player_type
        if player_type is None and google_sub:
            player_type = PlayerType.USER
        if player_type is None:
            player_type = PlayerType.GUEST

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
                player_type=player_type,
                google_sub=google_sub or None,
                linked_google_sub=linked_google_sub or google_sub or None,
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


def _extract_members(document: dict) -> List[PlaygroupMember]:
    members: List[PlaygroupMember] = []
    for entry in document.get("members", []) or []:
        try:
            members.append(PlaygroupMember.model_validate(entry))
        except Exception:
            logger.debug("Ignoring invalid playgroup member payload: %r", entry)
    members.sort(key=lambda member: (member.player_type.value, member.name or ""))
    return members


def _map_playgroup_summary(document: dict) -> PlaygroupSummary:
    data = {
        "id": document["id"],
        "name": document.get("name", ""),
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
        "last_used_at": document.get("last_used_at"),
        "game_count": int(document.get("game_count", 0)),
        "members": _extract_members(document),
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
            player_type=player.get("player_type"),
            google_sub=player.get("google_sub"),
            linked_google_sub=player.get("linked_google_sub"),
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


def _compute_playgroup_stats(games: Iterable[GameRecord]) -> PlaygroupStats:
    total_games = 0
    player_map: dict[str, PlayerPerformanceSummary] = {}
    deck_map: dict[str, DeckPerformanceSummary] = {}

    for game in games:
        total_games += 1
        ranking_lookup = {ranking.player_id: ranking.rank for ranking in game.rankings}
        for player in game.players:
            key = player.google_sub or player.id
            summary = player_map.get(key)
            if summary is None:
                summary = PlayerPerformanceSummary(
                    player_id=player.id,
                    google_sub=player.google_sub,
                    name=player.name,
                    games_played=0,
                    wins=0,
                    podiums=0,
                )
                player_map[key] = summary
            summary.games_played += 1
            rank = ranking_lookup.get(player.id)
            if rank is not None:
                if rank == 1:
                    summary.wins += 1
                if rank <= 3:
                    summary.podiums += 1

            deck_identifier = player.deck_id or player.deck_name
            if not deck_identifier:
                continue
            deck_summary = deck_map.get(deck_identifier)
            if deck_summary is None:
                deck_summary = DeckPerformanceSummary(
                    deck_id=player.deck_id,
                    deck_name=player.deck_name,
                    deck_format=player.deck_format,
                    wins=0,
                    games_played=0,
                )
                deck_map[deck_identifier] = deck_summary
            deck_summary.games_played += 1
            if rank == 1:
                deck_summary.wins += 1

    player_performance = sorted(
        player_map.values(),
        key=lambda entry: (-entry.wins, -entry.games_played, entry.name or ""),
    )
    deck_performance = sorted(
        deck_map.values(),
        key=lambda entry: (-entry.wins, -entry.games_played, entry.deck_name or ""),
    )

    return PlaygroupStats(
        total_games=total_games,
        player_performance=player_performance,
        deck_performance=deck_performance,
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
    members_payload = None
    if cleaned.members is not None:
        members_payload = _clean_members_payload(cleaned.members)
    document = await repository.upsert(owner_sub, cleaned.name, members=members_payload)
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
    players = _clean_player_payload(payload.players, owner_sub)

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


async def get_playgroup_detail(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    playgroup_id: str,
) -> PlaygroupDetail:
    repository = PlaygroupRepository(database)
    document = await repository.find_by_id(owner_sub, playgroup_id)
    if not document:
        raise LookupError("Groupe introuvable.")

    members = _extract_members(document)
    games = await list_games(database, owner_sub, playgroup_id=playgroup_id)
    stats = _compute_playgroup_stats(games.games)
    recent_games = games.games[:5]

    return PlaygroupDetail(
        id=document["id"],
        name=document.get("name", ""),
        created_at=document.get("created_at"),
        updated_at=document.get("updated_at"),
        last_used_at=document.get("last_used_at"),
        game_count=int(document.get("game_count", 0)),
        members=members,
        stats=stats,
        recent_games=recent_games,
    )


async def update_playgroup(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    playgroup_id: str,
    payload: PlaygroupUpdate,
) -> PlaygroupSummary:
    repository = PlaygroupRepository(database)
    document = await repository.find_by_id(owner_sub, playgroup_id)
    if not document:
        raise LookupError("Groupe introuvable.")

    if payload.name is not None:
        name = _clean_playgroup_name(payload.name)
        if document.get("name") != name:
            document["name"] = name
            document["slug"] = repository._slugify(name)

    if payload.members is not None:
        existing_members = document.get("members") or []
        document["members"] = _clean_members_payload(payload.members, existing=existing_members)

    document["updated_at"] = _now()
    await repository.save(document)

    return _map_playgroup_summary(document)


async def delete_playgroup(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    playgroup_id: str,
) -> None:
    repository = PlaygroupRepository(database)
    deleted = await repository.delete(owner_sub, playgroup_id)
    if not deleted:
        raise LookupError("Groupe introuvable.")
