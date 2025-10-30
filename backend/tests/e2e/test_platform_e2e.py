"""End-to-end integration tests that exercise the primary platform flows."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import pytest
from httpx import ASGITransport, AsyncClient

from app import main as app_main
from app.dependencies import get_mongo_database, get_moxfield_client
from app.main import create_app
from backend.tests.utils import StubDatabase, StubMoxfieldClient

pytestmark = pytest.mark.anyio


@pytest.fixture()
def anyio_backend() -> str:
    """Force the anyio plugin to run against asyncio only."""
    return "asyncio"

MOXFIELD_DETAILS_PAYLOAD = {
    "user": {
        "userName": "podcaster",
        "displayName": "Pod Caster",
        "profileImageUrl": "https://cdn.example.com/u/podcaster.png",
        "badges": [{"name": "Creator"}],
    },
    "decks": [
        {
            "id": "deck-internal-001",
            "publicId": "deck-public-001",
            "name": "Krenko Mayhem",
            "format": "commander",
            "visibility": "public",
            "description": "Goblins go brrr.",
            "publicUrl": "https://moxfield.com/decks/deck-public-001",
            "createdAtUtc": "2024-01-01T00:00:00Z",
            "lastUpdatedAtUtc": "2024-01-05T00:00:00Z",
            "likeCount": 12,
            "viewCount": 48,
            "commentCount": 3,
            "bookmarkCount": 7,
            "createdByUser": {
                "userName": "podcaster",
                "displayName": "Pod Caster",
                "profileImageUrl": "https://cdn.example.com/u/podcaster.png",
            },
            "authors": [
                {
                    "userName": "podcaster",
                    "displayName": "Pod Caster",
                    "profileImageUrl": "https://cdn.example.com/u/podcaster.png",
                }
            ],
            "authorTags": {"Krenko, Mob Boss": ["tribal", "combo"]},
            "hubs": [{"name": "Aggro"}],
            "colors": ["R"],
            "colorIdentity": ["R"],
            "boards": {
                "mainboard": {
                    "count": 2,
                    "cards": {
                        "entry-1": {
                            "quantity": 1,
                            "finish": "nonFoil",
                            "isFoil": False,
                            "isAlter": False,
                            "isProxy": False,
                            "card": {
                                "name": "Skirk Prospector",
                                "colorIdentity": ["R"],
                            },
                        },
                        "entry-2": {
                            "quantity": 1,
                            "finish": "nonFoil",
                            "isFoil": False,
                            "isAlter": False,
                            "isProxy": False,
                            "card": {
                                "name": "Goblin Chieftain",
                                "color_identity": ["R"],
                            },
                        },
                    },
                }
            },
            "tokens": [],
        }
    ],
}

MOXFIELD_SUMMARY_PAYLOAD = {
    "userName": "podcaster",
    "displayName": "Pod Caster",
    "profileImageUrl": "https://cdn.example.com/u/podcaster.png",
    "badges": [{"name": "Creator"}],
}

MOXFIELD_DECK_SUMMARIES = [
    {
        "id": "deck-summary-001",
        "publicId": "deck-public-001",
        "name": "Krenko Mayhem",
        "format": "commander",
        "visibility": "public",
        "description": "Goblins go brrr.",
        "publicUrl": "https://moxfield.com/decks/deck-public-001",
        "createdAtUtc": "2024-01-01T00:00:00Z",
        "lastUpdatedAtUtc": "2024-01-05T00:00:00Z",
        "likeCount": 12,
        "viewCount": 48,
        "commentCount": 3,
        "bookmarkCount": 7,
        "createdByUser": {
            "userName": "podcaster",
            "displayName": "Pod Caster",
            "profileImageUrl": "https://cdn.example.com/u/podcaster.png",
        },
        "authors": [
            {
                "userName": "podcaster",
                "displayName": "Pod Caster",
                "profileImageUrl": "https://cdn.example.com/u/podcaster.png",
            }
        ],
        "authorTags": {"Krenko, Mob Boss": ["tribal", "combo"]},
        "hubs": [{"name": "Aggro"}],
        "colors": ["R"],
        "colorIdentity": ["R"],
    }
]


@pytest.fixture()
async def e2e_context() -> dict[str, Any]:
    """Provide an AsyncClient wired to the FastAPI app with stubbed dependencies."""
    app = create_app()
    stub_db = StubDatabase()
    stub_moxfield = StubMoxfieldClient(
        payload=MOXFIELD_DETAILS_PAYLOAD,
        summary_payload=MOXFIELD_SUMMARY_PAYLOAD,
        deck_summaries=MOXFIELD_DECK_SUMMARIES,
    )
    app.dependency_overrides[get_mongo_database] = lambda: stub_db
    app.dependency_overrides[get_moxfield_client] = lambda: stub_moxfield

    original_get_db: Callable[[], Any] = app_main.get_mongo_database  # type: ignore[assignment]
    original_close: Callable[[], Any] = app_main.close_mongo_client  # type: ignore[assignment]
    app_main.get_mongo_database = lambda: stub_db  # type: ignore[assignment]
    app_main.close_mongo_client = lambda: None  # type: ignore[assignment]

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield {"client": client, "stub_db": stub_db}

    app.dependency_overrides.clear()
    app_main.get_mongo_database = original_get_db  # type: ignore[assignment]
    app_main.close_mongo_client = original_close  # type: ignore[assignment]


async def test_full_platform_flow(e2e_context: dict[str, object]) -> None:
    """Drive a representative user journey across the backend surface."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "user-owner"
    friend_sub = "user-friend"
    now_iso = datetime.now(timezone.utc).isoformat()

    owner_profile_payload = {
        "email": "owner@example.com",
        "display_name": "Owner One",
        "given_name": "Owner",
        "picture": "https://cdn.example.com/u/owner.png",
        "description": "Commander enjoyer with weekly pods.",
        "moxfield_handle": "podcaster",
        "is_public": True,
        "moxfield_decks": [
            {
                "public_id": "deck-public-001",
                "name": "Krenko Mayhem",
                "format": "commander",
                "updated_at": now_iso,
                "url": "https://moxfield.com/decks/deck-public-001",
            }
        ],
    }
    response = await client.put(f"/profiles/{owner_sub}", json=owner_profile_payload)
    assert response.status_code == 200
    owner_profile = response.json()
    assert owner_profile["google_sub"] == owner_sub
    assert owner_profile["is_public"] is True
    assert owner_profile["moxfield_decks"][0]["public_id"] == "deck-public-001"

    friend_profile_payload = {
        "email": "friend@example.com",
        "display_name": "Friend One",
        "description": "Always up for a pod.",
        "is_public": True,
    }
    response = await client.put(f"/profiles/{friend_sub}", json=friend_profile_payload)
    assert response.status_code == 200
    assert response.json()["google_sub"] == friend_sub

    response = await client.get(f"/profiles/{owner_sub}")
    assert response.status_code == 200
    assert response.json()["display_name"] == "Owner One"

    decks_response = await client.get("/users/podcaster/decks")
    assert decks_response.status_code == 200
    decks_payload = decks_response.json()
    assert decks_payload["total_decks"] == 1
    deck_public_id = decks_payload["decks"][0]["public_id"]

    cache_response = await client.get("/cache/users/podcaster/decks")
    assert cache_response.status_code == 200
    assert cache_response.json()["decks"][0]["public_id"] == deck_public_id

    summary_response = await client.get("/users/podcaster/deck-summaries")
    assert summary_response.status_code == 200
    cached_summary = await client.get("/cache/users/podcaster/deck-summaries")
    assert cached_summary.status_code == 200
    assert cached_summary.json()["decks"][0]["public_id"] == deck_public_id

    personalization_payload = {
        "notes": "Prioritise fast mana and goblin token bursts.",
        "bracket": "casual",
        "tags": ["goblins", "tokens"],
        "personal_tag": "league night",
    }
    personalization_response = await client.put(
        f"/profiles/{owner_sub}/deck-personalizations/{deck_public_id}",
        json=personalization_payload,
    )
    assert personalization_response.status_code == 200
    personalization_body = personalization_response.json()
    assert personalization_body["deckId"] == deck_public_id
    assert personalization_body["notes"].startswith("Prioritise")

    personalizations_list = await client.get(f"/profiles/{owner_sub}/deck-personalizations")
    assert personalizations_list.status_code == 200
    assert personalizations_list.json()["personalizations"]

    create_player = await client.post(
        f"/profiles/{owner_sub}/players",
        json={"name": "Guest Ally"},
    )
    assert create_player.status_code == 201
    player_body = create_player.json()
    player_id = player_body["id"]
    assert player_body["playerType"] == "guest"

    update_player = await client.put(
        f"/profiles/{owner_sub}/players/{player_id}",
        json={"name": "Guest Ally Prime"},
    )
    assert update_player.status_code == 200
    assert update_player.json()["name"] == "Guest Ally Prime"

    link_player = await client.post(
        f"/profiles/{owner_sub}/players/{player_id}/link",
        json={"google_sub": friend_sub},
    )
    assert link_player.status_code == 200
    linked_player = link_player.json()
    assert linked_player["playerType"] == "user"
    assert linked_player["google_sub"] == friend_sub

    players_response = await client.get(f"/profiles/{owner_sub}/players")
    assert players_response.status_code == 200
    assert any(entry["id"] == player_id for entry in players_response.json()["players"])

    playgroup_payload = {
        "name": "Tuesday Night Pod",
        "members": [
            {"playerType": "user", "googleSub": owner_sub, "name": "Owner One"},
            {"playerType": "user", "googleSub": friend_sub, "name": "Friend One"},
            {"playerType": "guest", "name": "Guest Ally Prime"},
        ],
    }
    playgroup_response = await client.post(
        f"/profiles/{owner_sub}/playgroups",
        json=playgroup_payload,
    )
    assert playgroup_response.status_code == 201
    playgroup = playgroup_response.json()
    playgroup_id = playgroup["id"]
    members = playgroup["members"]
    assert any(member["playerType"] == "user" and member.get("googleSub") == owner_sub for member in members)
    assert any(member["playerType"] == "user" and member.get("googleSub") == friend_sub for member in members)
    assert any(member["playerType"] == "guest" for member in members)

    playgroups_list = await client.get(f"/profiles/{owner_sub}/playgroups")
    assert playgroups_list.status_code == 200
    assert any(pg["id"] == playgroup_id for pg in playgroups_list.json()["playgroups"])

    playgroup_detail = await client.get(f"/profiles/{owner_sub}/playgroups/{playgroup_id}")
    assert playgroup_detail.status_code == 200
    assert playgroup_detail.json()["game_count"] == 0

    owner_player_id = "player-owner"
    friend_player_id = "player-friend"
    guest_player_id = "player-guest"
    game_payload = {
        "playgroup": {"id": playgroup_id, "name": "Tuesday Night Pod"},
        "players": [
            {
                "id": owner_player_id,
                "name": "Owner One",
                "is_owner": True,
                "deck_id": deck_public_id,
                "deck_name": "Krenko Mayhem",
                "deck_format": "commander",
                "playerType": "user",
                "googleSub": owner_sub,
            },
            {
                "id": friend_player_id,
                "name": "Friend One",
                "playerType": "user",
                "googleSub": friend_sub,
            },
            {
                "id": guest_player_id,
                "name": "Guest Ally Prime",
                "playerType": "guest",
            },
        ],
        "rankings": [
            {"player_id": owner_player_id, "rank": 1},
            {"player_id": friend_player_id, "rank": 2},
            {"player_id": guest_player_id, "rank": 3},
        ],
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "notes": "Owner closes the game with 40 goblins.",
    }
    game_response = await client.post(
        f"/profiles/{owner_sub}/games",
        json=game_payload,
    )
    assert game_response.status_code == 201, game_response.text
    assert game_response.json()["playgroup"]["id"] == playgroup_id

    games_list = await client.get(
        f"/profiles/{owner_sub}/games",
        params={"playgroup_id": playgroup_id},
    )
    assert games_list.status_code == 200
    assert games_list.json()["games"]

    updated_playgroup = await client.get(f"/profiles/{owner_sub}/playgroups/{playgroup_id}")
    assert updated_playgroup.status_code == 200
    playgroup_body = updated_playgroup.json()
    assert playgroup_body["game_count"] == 1
    assert playgroup_body["stats"]["total_games"] == 1
    assert playgroup_body["recent_games"][0]["rankings"][0]["rank"] == 1

    available_players = await client.get(f"/profiles/{owner_sub}/players/available")
    assert available_players.status_code == 200
    available_names = {entry["google_sub"] for entry in available_players.json()["players"] if entry["google_sub"]}
    assert owner_sub in available_names
    assert friend_sub in available_names

    follow_response = await client.post(
        f"/social/users/{owner_sub}/follow",
        json={"target_sub": friend_sub},
    )
    assert follow_response.status_code == 204

    search_response = await client.get(
        "/social/users/search",
        params={"q": "Friend", "viewer": owner_sub},
    )
    assert search_response.status_code == 200
    assert search_response.json()["results"][0]["is_followed"] is True

    following_response = await client.get(f"/social/users/{owner_sub}/following")
    assert following_response.status_code == 200
    assert following_response.json()["following"][0]["google_sub"] == friend_sub

    public_profile = await client.get(f"/social/users/{friend_sub}")
    assert public_profile.status_code == 200
    assert public_profile.json()["followers_count"] == 1

    unfollow_response = await client.delete(f"/social/users/{owner_sub}/follow/{friend_sub}")
    assert unfollow_response.status_code == 204

    following_after_unfollow = await client.get(f"/social/users/{owner_sub}/following")
    assert following_after_unfollow.status_code == 200
    assert following_after_unfollow.json()["following"] == []

    delete_deck = await client.delete(f"/users/podcaster/decks/{deck_public_id}")
    assert delete_deck.status_code == 204

    cache_after_delete = await client.get("/cache/users/podcaster/decks")
    assert cache_after_delete.status_code == 200
    assert cache_after_delete.json()["decks"] == []
