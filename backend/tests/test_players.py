"""Tests for player discovery services."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.config import get_settings
from app.schemas import PlayerType
from app.services.players import list_available_players
from backend.tests.utils import StubDatabase

pytestmark = pytest.mark.anyio


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


async def test_list_available_players_merges_followed_profiles() -> None:
    database = StubDatabase()
    settings = get_settings()
    players_collection = database[settings.mongo_players_collection]
    follows_collection = database[settings.mongo_follows_collection]
    profiles_collection = database[settings.mongo_users_collection]

    now = datetime.now(timezone.utc)
    players_collection.documents.append(
        {
            "id": "tracked-1",
            "owner_sub": "owner-1",
            "name": "Existing Player",
            "player_type": PlayerType.USER.value,
            "google_sub": "target-1",
            "linked_google_sub": "target-1",
            "decks": [],
            "created_at": now - timedelta(days=5),
            "updated_at": now - timedelta(days=5),
        }
    )

    follows_collection.documents.extend(
        [
            {
                "follower_sub": "owner-1",
                "target_sub": "target-1",
                "created_at": now - timedelta(days=3),
            },
            {
                "follower_sub": "owner-1",
                "target_sub": " target-2 ",
                "created_at": now - timedelta(days=1),
            },
        ]
    )

    profiles_collection.documents.extend(
        [
            {
                "google_sub": "owner-1",
                "display_name": "Owner Name",
                "is_public": True,
                "created_at": now - timedelta(days=10),
                "updated_at": now - timedelta(days=1),
                "moxfield_decks": [],
            },
            {
                "google_sub": "target-1",
                "display_name": "Target One",
                "is_public": True,
                "created_at": now - timedelta(days=8),
                "updated_at": now - timedelta(days=2),
                "moxfield_decks": [
                    {
                        "public_id": "deck-1",
                        "name": "Deck One",
                        "format": "commander",
                    }
                ],
            },
            {
                "google_sub": "target-2",
                "display_name": "Target Two",
                "is_public": True,
                "created_at": now - timedelta(days=7),
                "updated_at": now - timedelta(days=1),
                "moxfield_decks": [
                    {
                        "public_id": "deck-2",
                        "name": "Deck Two",
                        "format": "commander",
                    }
                ],
            },
        ]
    )

    player_list = await list_available_players(database, "owner-1")
    players_by_id = {player.id: player for player in player_list.players}

    assert "tracked-1" in players_by_id
    tracked_player = players_by_id["tracked-1"]
    assert tracked_player.google_sub == "target-1"
    assert tracked_player.decks
    assert tracked_player.decks[0].public_id == "deck-1"

    owner_key = "user:owner-1"
    assert owner_key in players_by_id
    assert players_by_id[owner_key].google_sub == "owner-1"
    assert players_by_id[owner_key].player_type == PlayerType.USER

    follow_key = "user:target-2"
    assert follow_key in players_by_id
    assert players_by_id[follow_key].name == "Target Two"
    assert players_by_id[follow_key].decks[0].public_id == "deck-2"
