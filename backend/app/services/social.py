"""Domain services for social discovery and follow relationships."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..config import get_settings
from ..logging_utils import get_logger
from ..repositories import FollowRepository
from ..schemas import (
    FollowList,
    FollowSummary,
    PublicGameSummary,
    PublicUserProfile,
    UserSearchResult,
)
from .play_data import list_games
from .profiles import fetch_user_profile

logger = get_logger("services.social")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_query(value: str | None) -> str:
    return value.strip().casefold() if isinstance(value, str) else ""


async def _load_following_set(
    repository: FollowRepository,
    follower_sub: str,
) -> set[str]:
    entries = await repository.list_following(follower_sub)
    return {entry.get("target_sub") for entry in entries if entry.get("target_sub")}


async def search_public_profiles(
    database: AsyncIOMotorDatabase,
    query: str,
    *,
    viewer_sub: str | None = None,
    limit: int = 20,
) -> List[UserSearchResult]:
    normalized_query = _normalize_query(query)
    settings = get_settings()
    profiles_collection = database[settings.mongo_users_collection]

    raw_documents = await profiles_collection.find({}).to_list(length=None)  # type: ignore[attr-defined]
    follow_repository = FollowRepository(database)
    followed_targets = await _load_following_set(follow_repository, viewer_sub) if viewer_sub else set()

    matches: List[UserSearchResult] = []
    for document in raw_documents:
        if not document.get("is_public"):
            continue
        google_sub = document.get("google_sub")
        if not google_sub:
            continue
        display_name = document.get("display_name") or document.get("given_name") or ""
        email = document.get("email") or ""

        haystack = " ".join([display_name, email]).casefold()
        if normalized_query and normalized_query not in haystack:
            continue

        matches.append(
            UserSearchResult(
                google_sub=google_sub,
                display_name=document.get("display_name"),
                description=document.get("description"),
                picture=document.get("picture"),
                is_public=bool(document.get("is_public")),
                is_followed=google_sub in followed_targets,
            )
        )
        if len(matches) >= limit:
            break

    matches.sort(key=lambda entry: (entry.display_name or "").lower())
    return matches


async def get_public_profile(
    database: AsyncIOMotorDatabase,
    google_sub: str,
) -> PublicUserProfile:
    profile = await fetch_user_profile(database, google_sub)
    if not profile or not profile.is_public:
        raise LookupError("Profil introuvable.")

    follow_repository = FollowRepository(database)
    followers_count = await follow_repository.count_followers(google_sub)
    following_count = await follow_repository.count_following(google_sub)

    deck_payloads = [deck.model_dump(mode="python") for deck in profile.moxfield_decks]

    games_payload = await list_games(database, google_sub)
    recent_games: List[PublicGameSummary] = []
    for record in games_payload.games[:5]:
        winner = None
        runner_up = None
        rankings = sorted(record.rankings, key=lambda entry: entry.rank)
        if rankings:
            winner_id = rankings[0].player_id
            winner_player = next((player for player in record.players if player.id == winner_id), None)
            winner = winner_player.name if winner_player else None
        if len(rankings) > 1:
            runner_up_id = rankings[1].player_id
            runner_player = next((player for player in record.players if player.id == runner_up_id), None)
            runner_up = runner_player.name if runner_player else None

        recent_games.append(
            PublicGameSummary(
                id=record.id,
                playgroup_name=record.playgroup.name if record.playgroup else None,
                created_at=record.created_at,
                winner=winner,
                runner_up=runner_up,
            )
        )

    return PublicUserProfile(
        google_sub=google_sub,
        display_name=profile.display_name,
        description=profile.description,
        picture=profile.picture,
        followers_count=followers_count,
        following_count=following_count,
        moxfield_decks=deck_payloads,
        recent_games=recent_games,
    )


async def follow_user(
    database: AsyncIOMotorDatabase,
    follower_sub: str,
    target_sub: str,
) -> None:
    if follower_sub == target_sub:
        raise ValueError("Vous ne pouvez pas vous suivre vous-même.")
    repository = FollowRepository(database)
    await repository.add_follow(follower_sub, target_sub)


async def unfollow_user(
    database: AsyncIOMotorDatabase,
    follower_sub: str,
    target_sub: str,
) -> None:
    repository = FollowRepository(database)
    await repository.remove_follow(follower_sub, target_sub)


async def list_following(
    database: AsyncIOMotorDatabase,
    follower_sub: str,
) -> FollowList:
    repository = FollowRepository(database)
    entries = await repository.list_following(follower_sub)
    summaries: List[FollowSummary] = []

    for entry in entries:
        google_sub = entry.get("target_sub")
        if not google_sub:
            continue
        profile = await fetch_user_profile(database, google_sub)
        summaries.append(
            FollowSummary(
                google_sub=google_sub,
                display_name=profile.display_name if profile else None,
                picture=profile.picture if profile else None,
                followed_at=entry.get("created_at") or _now(),
            )
        )

    return FollowList(following=summaries)
