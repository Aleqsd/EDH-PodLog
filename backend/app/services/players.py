"""Domain services for tracked players and participant discovery."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..logging_utils import get_logger
from ..repositories import FollowRepository, GameRepository, PlayerRepository
from ..schemas import (
    MoxfieldDeckSelection,
    PlayerCreate,
    PlayerLinkRequest,
    PlayerList,
    PlayerSummary,
    PlayerType,
    PlayerUpdate,
)
from .profiles import fetch_user_profile

logger = get_logger("services.players")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _trim(value: str | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _map_player_document(document: dict) -> PlayerSummary:
    player_type_value = document.get("player_type") or PlayerType.GUEST.value
    try:
        player_type = PlayerType(player_type_value)
    except ValueError:
        player_type = PlayerType.GUEST

    created_at = document.get("created_at") or _now()
    updated_at = document.get("updated_at") or created_at
    decks_payload: List[MoxfieldDeckSelection] = []
    for raw_deck in document.get("decks") or []:
        if isinstance(raw_deck, MoxfieldDeckSelection):
            decks_payload.append(raw_deck)
        else:
            try:
                decks_payload.append(MoxfieldDeckSelection.model_validate(raw_deck))
            except Exception:
                logger.debug("Ignoring invalid deck payload for player '%s'.", document.get("id"))

    return PlayerSummary(
        id=document.get("id"),
        name=document.get("name", ""),
        player_type=player_type,
        owner_sub=document.get("owner_sub"),
        google_sub=document.get("google_sub"),
        linked_google_sub=document.get("linked_google_sub"),
        decks=decks_payload,
        created_at=created_at,
        updated_at=updated_at,
    )


def _build_summary_from_profile(
    owner_sub: str,
    profile,
    *,
    identifier: str,
    google_sub: str | None,
    created_at: datetime,
) -> PlayerSummary:
    decks: List[MoxfieldDeckSelection] = []
    if profile and getattr(profile, "moxfield_decks", None):
        decks = [deck for deck in profile.moxfield_decks]

    name = getattr(profile, "display_name", None) or getattr(profile, "given_name", None)
    if not name:
        name = getattr(profile, "email", None) or "Joueur connu"

    resolved_google_sub = google_sub or getattr(profile, "google_sub", None)

    return PlayerSummary(
        id=identifier,
        name=name,
        player_type=PlayerType.USER,
        owner_sub=owner_sub,
        google_sub=resolved_google_sub,
        linked_google_sub=resolved_google_sub,
        decks=decks,
        created_at=created_at,
        updated_at=getattr(profile, "updated_at", created_at),
    )


async def list_tracked_players(database: AsyncIOMotorDatabase, owner_sub: str) -> PlayerList:
    repository = PlayerRepository(database)
    documents = await repository.list_for_owner(owner_sub)
    summaries = [_map_player_document(document) for document in documents]
    return PlayerList(players=summaries)


async def create_tracked_player(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    payload: PlayerCreate,
) -> PlayerSummary:
    repository = PlayerRepository(database)
    name = _trim(payload.name)
    if not name:
        raise ValueError("Le nom du joueur est obligatoire.")
    document = await repository.create(owner_sub, name)
    return _map_player_document(document)


async def update_tracked_player(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    player_id: str,
    payload: PlayerUpdate,
) -> PlayerSummary:
    repository = PlayerRepository(database)
    updates: dict[str, str] = {}
    if payload.name is not None:
        name = _trim(payload.name)
        if not name:
            raise ValueError("Le nom du joueur est obligatoire.")
        updates["name"] = name

    if not updates:
        document = await repository.find_by_id(owner_sub, player_id)
    else:
        document = await repository.update(owner_sub, player_id, name=updates.get("name"))

    if not document:
        raise LookupError("Joueur introuvable.")
    return _map_player_document(document)


async def delete_tracked_player(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    player_id: str,
) -> None:
    repository = PlayerRepository(database)
    deleted = await repository.delete(owner_sub, player_id)
    if not deleted:
        raise LookupError("Joueur introuvable.")


async def link_tracked_player(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
    player_id: str,
    payload: PlayerLinkRequest,
) -> PlayerSummary:
    repository = PlayerRepository(database)
    google_sub = _trim(payload.google_sub)
    if not google_sub:
        raise ValueError("L'identifiant utilisateur à lier est obligatoire.")

    document = await repository.link_to_google_sub(owner_sub, player_id, google_sub)
    if not document:
        raise LookupError("Joueur introuvable.")

    profile = await fetch_user_profile(database, google_sub)
    if profile:
        decks_payload = [deck.model_dump(mode="python") for deck in profile.moxfield_decks]
    else:
        decks_payload = []

    document["decks"] = decks_payload
    document["updated_at"] = _now()
    await repository.save(document)

    games = GameRepository(database)
    await games.update_player_identity(
        owner_sub,
        player_id,
        google_sub=google_sub,
        player_type=PlayerType.USER.value,
        name=document.get("name"),
    )

    return _map_player_document(document)


async def list_available_players(
    database: AsyncIOMotorDatabase,
    owner_sub: str,
) -> PlayerList:
    repository = PlayerRepository(database)
    follow_repository = FollowRepository(database)

    tracked_documents = await repository.list_for_owner(owner_sub)
    tracked_players: dict[str, PlayerSummary] = {
        document["id"]: _map_player_document(document)
        for document in tracked_documents
    }

    now = _now()

    owner_profile = await fetch_user_profile(database, owner_sub)
    owner_identifier = f"user:{owner_sub}"
    owner_summary = _build_summary_from_profile(
        owner_sub,
        owner_profile,
        identifier=owner_identifier,
        google_sub=owner_sub,
        created_at=getattr(owner_profile, "created_at", now),
    )
    tracked_players[owner_identifier] = owner_summary

    following_entries = await follow_repository.list_following(owner_sub)
    for entry in following_entries:
        target_sub = entry.get("target_sub")
        if not target_sub:
            continue
        profile = await fetch_user_profile(database, target_sub)
        identifier = f"user:{target_sub}"

        if target_sub:
            existing = next(
                (
                    player
                    for player in tracked_players.values()
                    if player.google_sub == target_sub
                ),
                None,
            )
            if existing:
                if profile and profile.moxfield_decks and not existing.decks:
                    existing.decks = [deck for deck in profile.moxfield_decks]
                continue

        created_at = entry.get("created_at") or now
        summary = _build_summary_from_profile(
            owner_sub,
            profile,
            identifier=identifier,
            google_sub=target_sub,
            created_at=created_at,
        )
        tracked_players[identifier] = summary

    return PlayerList(players=list(tracked_players.values()))
