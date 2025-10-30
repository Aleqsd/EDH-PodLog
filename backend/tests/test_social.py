"""Tests for social domain services."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.config import get_settings
from app.services.social import get_public_profile, search_public_profiles
from backend.tests.utils import StubDatabase

pytestmark = pytest.mark.anyio


@pytest.fixture()
def anyio_backend() -> str:
    """Force AnyIO to execute against asyncio for async service helpers."""
    return "asyncio"


def _profiles_collection(database: StubDatabase) -> Any:
    settings = get_settings()
    return database[settings.mongo_users_collection]


def _follows_collection(database: StubDatabase) -> Any:
    settings = get_settings()
    return database[settings.mongo_follows_collection]


def _games_collection(database: StubDatabase) -> Any:
    settings = get_settings()
    return database[settings.mongo_games_collection]


async def test_search_public_profiles_filters_private_entries_and_limits_results() -> None:
    database = StubDatabase()
    profiles = _profiles_collection(database)
    follows = _follows_collection(database)

    profiles.documents.extend(
        [
            {
                "google_sub": "alpha",
                "display_name": "Alpha Bard",
                "email": "alpha@example.com",
                "description": "Always ready to jam.",
                "is_public": True,
            },
            {
                "google_sub": "beta",
                "display_name": "Beta Bard",
                "email": "beta@example.com",
                "is_public": True,
            },
            {
                "google_sub": "gamma",
                "display_name": "Gamma Bard",
                "email": "gamma@example.com",
                "is_public": True,
            },
            {
                "google_sub": "hidden",
                "display_name": "Hidden Maestro",
                "email": "hidden@example.com",
                "is_public": False,
            },
            {
                "google_sub": None,
                "display_name": "Anon Bard",
                "email": "anon@example.com",
                "is_public": True,
            },
        ]
    )

    follows.documents.extend(
        [
            {
                "follower_sub": "viewer",
                "target_sub": "beta",
                "created_at": datetime.now(timezone.utc) - timedelta(days=1),
            },
        ]
    )

    results = await search_public_profiles(
        database,
        "   BaRd  ",
        viewer_sub="viewer",
        limit=2,
    )

    assert len(results) == 2
    # Results are sorted alphabetically by display name.
    assert [entry.google_sub for entry in results] == ["alpha", "beta"]
    assert [entry.display_name for entry in results] == ["Alpha Bard", "Beta Bard"]
    assert results[0].is_public is True
    assert results[0].is_followed is False
    assert results[1].is_followed is True


async def test_get_public_profile_returns_recent_games_and_counts_followers() -> None:
    database = StubDatabase()
    profiles = _profiles_collection(database)
    follows = _follows_collection(database)
    games = _games_collection(database)

    now = datetime.now(timezone.utc)
    profile_document = {
        "google_sub": "public-hero",
        "display_name": "Public Hero",
        "description": "Open for community matches.",
        "picture": "https://example.com/public.png",
        "email": "public@example.com",
        "moxfield_decks": [
            {
                "public_id": "deck-1",
                "name": "Deck One",
                "format": "commander",
                "url": "https://moxfield.com/decks/deck-1",
            }
        ],
        "is_public": True,
        "created_at": now - timedelta(days=10),
        "updated_at": now - timedelta(days=1),
    }
    profiles.documents.append(profile_document)

    private_profile = dict(profile_document)
    private_profile.update(
        {
            "google_sub": "private-hero",
            "display_name": "Private Hero",
            "is_public": False,
            "email": "private@example.com",
        }
    )
    profiles.documents.append(private_profile)

    follows.documents.extend(
        [
            {"follower_sub": "fan-1", "target_sub": "public-hero", "created_at": now - timedelta(days=3)},
            {"follower_sub": "fan-2", "target_sub": "public-hero", "created_at": now - timedelta(days=2)},
            {"follower_sub": "public-hero", "target_sub": "mentor", "created_at": now - timedelta(days=5)},
        ]
    )

    for index in range(6):
        created_at = now - timedelta(hours=index)
        game_id = f"game-{index}"
        games.documents.append(
            {
                "id": game_id,
                "owner_sub": "public-hero",
                "playgroup_id": "pg-001",
                "playgroup_name": "Heroic Pods",
                "created_at": created_at,
                "updated_at": created_at,
                "players": [
                    {"id": "alice", "name": "Alice", "order": 0},
                    {"id": "bob", "name": "Bob", "order": 1},
                    {"id": "carol", "name": "Carol", "order": 2},
                ],
                "rankings": [
                    {"player_id": "alice", "rank": 1},
                    {"player_id": "bob", "rank": 2},
                    {"player_id": "carol", "rank": 3},
                ],
            }
        )

    public_profile = await get_public_profile(database, "public-hero")

    assert public_profile.google_sub == "public-hero"
    assert public_profile.display_name == "Public Hero"
    assert public_profile.followers_count == 2
    assert public_profile.following_count == 1
    assert len(public_profile.moxfield_decks) == 1

    recent_games = public_profile.recent_games
    assert len(recent_games) == 5
    # Most recent game is returned first.
    assert recent_games[0].id == "game-0"
    assert recent_games[0].winner == "Alice"
    assert recent_games[0].runner_up == "Bob"
    # Oldest game should be omitted from the top five.
    assert all(game.id != "game-5" for game in recent_games)

    with pytest.raises(LookupError):
        await get_public_profile(database, "private-hero")
