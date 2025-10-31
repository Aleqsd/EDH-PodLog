"""End-to-end integration tests that exercise the primary platform flows."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Callable

import pytest
from httpx import ASGITransport, AsyncClient

from app import main as app_main
from app.dependencies import get_mongo_database, get_moxfield_client
from app.main import create_app
from app.moxfield import MoxfieldError, MoxfieldNotFoundError
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


def _build_default_stub_moxfield() -> StubMoxfieldClient:
    return StubMoxfieldClient(
        payload=MOXFIELD_DETAILS_PAYLOAD,
        summary_payload=MOXFIELD_SUMMARY_PAYLOAD,
        deck_summaries=MOXFIELD_DECK_SUMMARIES,
    )


@asynccontextmanager
async def _stubbed_app_context(stub_moxfield: StubMoxfieldClient) -> AsyncIterator[dict[str, Any]]:
    app = create_app()
    stub_db = StubDatabase()
    app.dependency_overrides[get_mongo_database] = lambda: stub_db
    app.dependency_overrides[get_moxfield_client] = lambda: stub_moxfield

    original_get_db: Callable[[], Any] = app_main.get_mongo_database  # type: ignore[assignment]
    original_close: Callable[[], Any] = app_main.close_mongo_client  # type: ignore[assignment]
    app_main.get_mongo_database = lambda: stub_db  # type: ignore[assignment]
    app_main.close_mongo_client = lambda: None  # type: ignore[assignment]

    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield {"client": client, "stub_db": stub_db}
    finally:
        app.dependency_overrides.clear()
        app_main.get_mongo_database = original_get_db  # type: ignore[assignment]
        app_main.close_mongo_client = original_close  # type: ignore[assignment]


@pytest.fixture()
async def e2e_context() -> dict[str, Any]:
    """Provide an AsyncClient wired to the FastAPI app with stubbed dependencies."""
    async with _stubbed_app_context(_build_default_stub_moxfield()) as context:
        yield context


async def _upsert_profile(
    client: AsyncClient,
    google_sub: str,
    *,
    display_name: str | None = None,
    is_public: bool = True,
    **overrides: Any,
) -> dict[str, Any]:
    """Create or update a user profile and return the stored payload."""
    payload: dict[str, Any] = {
        "display_name": display_name or f"Agent {google_sub}",
        "email": f"{google_sub}@example.com",
        "description": f"Profile for {google_sub}",
        "is_public": is_public,
    }
    payload.update(overrides)
    response = await client.put(f"/profiles/{google_sub}", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


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

    self_follow_response = await client.post(
        f"/social/users/{owner_sub}/follow",
        json={"target_sub": owner_sub},
    )
    assert self_follow_response.status_code == 400
    assert self_follow_response.json()["detail"] == "Vous ne pouvez pas vous suivre vous-même."

    following_after_self_attempt = await client.get(f"/social/users/{owner_sub}/following")
    assert following_after_self_attempt.status_code == 200
    assert following_after_self_attempt.json()["following"] == []

    delete_deck = await client.delete(f"/users/podcaster/decks/{deck_public_id}")
    assert delete_deck.status_code == 204

    cache_after_delete = await client.get("/cache/users/podcaster/decks")
    assert cache_after_delete.status_code == 200
    assert cache_after_delete.json()["decks"] == []


async def test_deck_cache_warmup_flow(e2e_context: dict[str, object]) -> None:
    """Cache endpoints should report misses until the deck sync runs."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    await _upsert_profile(client, "cache-owner", moxfield_handle="podcaster")

    cold_cache = await client.get("/cache/users/podcaster/decks")
    assert cold_cache.status_code == 404

    summary_sync = await client.get("/users/podcaster/deck-summaries")
    assert summary_sync.status_code == 200
    assert summary_sync.json()["total_decks"] == 1

    cached_summary = await client.get("/cache/users/podcaster/deck-summaries")
    assert cached_summary.status_code == 200
    assert cached_summary.json()["decks"][0]["public_id"] == "deck-public-001"

    decks_sync = await client.get("/users/podcaster/decks")
    assert decks_sync.status_code == 200
    assert decks_sync.json()["decks"][0]["boards"]

    delete_deck = await client.delete("/users/podcaster/decks/deck-public-001")
    assert delete_deck.status_code == 204

    cache_after_delete = await client.get("/cache/users/podcaster/decks")
    assert cache_after_delete.status_code == 200
    assert cache_after_delete.json()["decks"] == []


async def test_playgroup_update_and_delete_flow(e2e_context: dict[str, object]) -> None:
    """Playgroup metadata updates and deletions should persist."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "playgroup-owner"
    await _upsert_profile(client, owner_sub)
    await _upsert_profile(client, "ally-one")

    create_response = await client.post(
        f"/profiles/{owner_sub}/playgroups",
        json={
            "name": "Morning Pod",
            "members": [
                {"playerType": "user", "googleSub": owner_sub, "name": "Owner"},
                {"playerType": "guest", "name": "Guest One"},
            ],
        },
    )
    assert create_response.status_code == 201, create_response.text
    playgroup_id = create_response.json()["id"]

    update_response = await client.put(
        f"/profiles/{owner_sub}/playgroups/{playgroup_id}",
        json={
            "name": "Evening Pod",
            "members": [
                {"playerType": "user", "googleSub": owner_sub, "name": "Owner"},
                {"playerType": "user", "googleSub": "ally-one", "name": "Ally"},
            ],
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Evening Pod"

    detail_response = await client.get(f"/profiles/{owner_sub}/playgroups/{playgroup_id}")
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["name"] == "Evening Pod"
    member_types = {member["playerType"] for member in detail_payload["members"]}
    assert member_types == {"user"}

    delete_response = await client.delete(f"/profiles/{owner_sub}/playgroups/{playgroup_id}")
    assert delete_response.status_code == 204

    list_after_delete = await client.get(f"/profiles/{owner_sub}/playgroups")
    assert list_after_delete.status_code == 200
    assert list_after_delete.json()["playgroups"] == []


async def test_guest_player_validation_flow(e2e_context: dict[str, object]) -> None:
    """Guest player endpoints enforce validation and cleanup."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "player-owner"
    await _upsert_profile(client, owner_sub)

    create_player = await client.post(
        f"/profiles/{owner_sub}/players",
        json={"name": "Table Ally"},
    )
    assert create_player.status_code == 201
    player_id = create_player.json()["id"]

    invalid_update = await client.put(
        f"/profiles/{owner_sub}/players/{player_id}",
        json={"name": "   "},
    )
    assert invalid_update.status_code == 400

    invalid_link = await client.post(
        f"/profiles/{owner_sub}/players/{player_id}/link",
        json={"google_sub": "   "},
    )
    assert invalid_link.status_code == 400

    delete_player = await client.delete(f"/profiles/{owner_sub}/players/{player_id}")
    assert delete_player.status_code == 204

    players_after_delete = await client.get(f"/profiles/{owner_sub}/players")
    assert players_after_delete.status_code == 200
    assert players_after_delete.json()["players"] == []


async def test_public_profile_privacy_flow(e2e_context: dict[str, object]) -> None:
    """Search and public profile endpoints should respect privacy settings."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    await _upsert_profile(client, "viewer", display_name="Viewer", is_public=True)
    await _upsert_profile(
        client,
        "public-friend",
        display_name="Public Friend",
        is_public=True,
        description="Join our public pods.",
    )
    await _upsert_profile(
        client,
        "private-friend",
        display_name="Private Friend",
        is_public=False,
        description="Stealth strategist.",
    )

    search_results = await client.get(
        "/social/users/search",
        params={"q": "Friend", "viewer": "viewer"},
    )
    assert search_results.status_code == 200
    names = [entry["display_name"] for entry in search_results.json()["results"]]
    assert "Public Friend" in names
    assert "Private Friend" not in names

    follow_public = await client.post(
        "/social/users/viewer/follow",
        json={"target_sub": "public-friend"},
    )
    assert follow_public.status_code == 204

    follow_private = await client.post(
        "/social/users/viewer/follow",
        json={"target_sub": "private-friend"},
    )
    assert follow_private.status_code == 204

    following_list = await client.get("/social/users/viewer/following")
    assert following_list.status_code == 200
    following_subs = {entry["google_sub"] for entry in following_list.json()["following"]}
    assert {"public-friend", "private-friend"}.issubset(following_subs)

    public_profile = await client.get("/social/users/public-friend")
    assert public_profile.status_code == 200
    assert public_profile.json()["followers_count"] == 1

    private_profile = await client.get("/social/users/private-friend")
    assert private_profile.status_code == 404

    private_search = await client.get(
        "/social/users/search",
        params={"q": "Private", "viewer": "viewer"},
    )
    assert private_search.status_code == 200
    assert private_search.json()["results"] == []


async def test_deck_personalization_missing_returns_404(e2e_context: dict[str, object]) -> None:
    """Fetching a non-existent deck personalization should raise a 404."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "deckless-owner"
    await _upsert_profile(client, owner_sub)

    missing_personalization = await client.get(
        f"/profiles/{owner_sub}/deck-personalizations/missing-deck",
    )
    assert missing_personalization.status_code == 404

    listing_response = await client.get(f"/profiles/{owner_sub}/deck-personalizations")
    assert listing_response.status_code == 200
    assert listing_response.json()["personalizations"] == []


async def test_game_record_validation_errors(e2e_context: dict[str, object]) -> None:
    """Game recording should surface validation errors before persistence."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "validation-owner"
    await _upsert_profile(client, owner_sub)

    single_player_payload = {
        "playgroup": {"name": "Solo Pod"},
        "players": [
            {"id": "solo", "name": "Solo Player", "is_owner": True, "googleSub": owner_sub},
        ],
        "rankings": [{"player_id": "solo", "rank": 1}],
    }
    single_player_response = await client.post(
        f"/profiles/{owner_sub}/games",
        json=single_player_payload,
    )
    assert single_player_response.status_code == 400
    assert "Au moins deux joueurs" in single_player_response.json()["detail"]

    missing_ranking_payload = {
        "playgroup": {"name": "Ranking Pod"},
        "players": [
            {"id": "p1", "name": "Leader", "is_owner": True, "googleSub": owner_sub},
            {"id": "p2", "name": "Follower"},
        ],
        "rankings": [{"player_id": "p1", "rank": 1}],
    }
    missing_ranking_response = await client.post(
        f"/profiles/{owner_sub}/games",
        json=missing_ranking_payload,
    )
    assert missing_ranking_response.status_code == 400
    assert "Chaque joueur doit posséder un rang" in missing_ranking_response.json()["detail"]

    missing_playgroup_payload = {
        "playgroup": {"id": "missing-playgroup", "name": "Ghost Pod"},
        "players": [
            {"id": "p3", "name": "Owner", "is_owner": True, "googleSub": owner_sub},
            {"id": "p4", "name": "Partner"},
        ],
        "rankings": [
            {"player_id": "p3", "rank": 1},
            {"player_id": "p4", "rank": 2},
        ],
    }
    missing_playgroup_response = await client.post(
        f"/profiles/{owner_sub}/games",
        json=missing_playgroup_payload,
    )
    assert missing_playgroup_response.status_code == 404


async def test_linking_player_updates_game_history(e2e_context: dict[str, object]) -> None:
    """Linking a tracked player should update stored game entries."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "history-owner"
    friend_sub = "history-friend"

    await _upsert_profile(
        client,
        owner_sub,
        display_name="History Owner",
        moxfield_decks=[
            {
                "public_id": "history-deck",
                "name": "Historic Victory",
                "format": "commander",
                "url": "https://moxfield.com/decks/history-deck",
            }
        ],
    )
    await _upsert_profile(
        client,
        friend_sub,
        display_name="History Friend",
        moxfield_decks=[
            {
                "public_id": "friend-deck",
                "name": "Support Deck",
                "format": "commander",
                "url": "https://moxfield.com/decks/friend-deck",
            }
        ],
    )

    create_player = await client.post(
        f"/profiles/{owner_sub}/players",
        json={"name": "Guest Historian"},
    )
    assert create_player.status_code == 201
    player_id = create_player.json()["id"]

    recorded_at = datetime.now(timezone.utc).isoformat()
    record_game_response = await client.post(
        f"/profiles/{owner_sub}/games",
        json={
            "playgroup": {"name": "History Pod"},
            "players": [
                {
                    "id": player_id,
                    "name": "Guest Historian",
                    "playerType": "guest",
                },
                {
                    "id": "owner-player",
                    "name": "History Owner",
                    "playerType": "user",
                    "is_owner": True,
                    "googleSub": owner_sub,
                    "deck_id": "history-deck",
                    "deck_name": "Historic Victory",
                },
                {
                    "id": "ally-player",
                    "name": "Ally",
                    "playerType": "guest",
                },
            ],
            "rankings": [
                {"player_id": player_id, "rank": 1},
                {"player_id": "owner-player", "rank": 2},
                {"player_id": "ally-player", "rank": 3},
            ],
            "recorded_at": recorded_at,
        },
    )
    assert record_game_response.status_code == 201

    games_before_link = await client.get(f"/profiles/{owner_sub}/games")
    assert games_before_link.status_code == 200
    games_before_payload = games_before_link.json()["games"]
    assert games_before_payload, "Expected recorded games before linking."
    first_game = games_before_payload[0]
    before_updated_at = first_game["updated_at"]
    first_game_players = first_game["players"]
    guest_entry = next(player for player in first_game_players if player["id"] == player_id)
    assert guest_entry["playerType"] == "guest"
    assert (guest_entry.get("googleSub") or guest_entry.get("google_sub")) is None

    link_response = await client.post(
        f"/profiles/{owner_sub}/players/{player_id}/link",
        json={"google_sub": friend_sub},
    )
    assert link_response.status_code == 200
    link_payload = link_response.json()
    assert link_payload["playerType"] == "user"
    linked_google_sub = link_payload.get("googleSub") or link_payload.get("google_sub")
    assert linked_google_sub == friend_sub

    games_after_link = await client.get(f"/profiles/{owner_sub}/games")
    assert games_after_link.status_code == 200
    games_after_payload = games_after_link.json()["games"]
    assert games_after_payload, "Expected recorded games after linking."
    updated_game = games_after_payload[0]
    updated_players = updated_game["players"]
    linked_entry = next(player for player in updated_players if player["id"] == player_id)
    assert linked_entry["playerType"] == "user"
    assert (linked_entry.get("googleSub") or linked_entry.get("google_sub")) == friend_sub
    after_updated_at = updated_game["updated_at"]
    assert after_updated_at != before_updated_at


async def test_private_profile_hidden_from_social_endpoints(e2e_context: dict[str, object]) -> None:
    """Private profiles stay hidden from social endpoints and availability lists."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    viewer_sub = "privacy-viewer"
    public_sub = "privacy-public"
    private_sub = "privacy-hidden"

    await _upsert_profile(
        client,
        viewer_sub,
        display_name="Viewer",
        is_public=True,
    )
    await _upsert_profile(
        client,
        public_sub,
        display_name="Visible Ally",
        is_public=True,
        description="Happy to pod with everyone.",
    )
    await _upsert_profile(
        client,
        private_sub,
        display_name="Hidden Ally",
        is_public=False,
        description="Stealth mode enabled.",
    )

    hidden_profile = await client.get(f"/social/users/{private_sub}")
    assert hidden_profile.status_code == 404
    assert hidden_profile.json()["detail"] == "Profil introuvable."

    search_response = await client.get(
        "/social/users/search",
        params={"q": "Ally", "viewer": viewer_sub},
    )
    assert search_response.status_code == 200
    result_subs = {entry["google_sub"] for entry in search_response.json()["results"]}
    assert public_sub in result_subs
    assert private_sub not in result_subs

    available_response = await client.get(f"/profiles/{viewer_sub}/players/available")
    assert available_response.status_code == 200
    available_players = available_response.json()["players"]
    available_google_subs = {
        entry.get("google_sub") or entry.get("googleSub")
        for entry in available_players
        if entry.get("google_sub") or entry.get("googleSub")
    }
    assert viewer_sub in available_google_subs
    assert private_sub not in available_google_subs


async def test_deck_personalization_sanitizes_payload(e2e_context: dict[str, object]) -> None:
    """Deck personalization storage should normalize incoming payloads."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "personalization-owner"
    deck_id = "deck-public-001"

    await _upsert_profile(client, owner_sub, is_public=True)

    long_notes = "N" * 2100
    payload = {
        "ratings": {"consistance": 6, "interaction": 0, "resilience": 3},
        "bracket": " 4 ",
        "playstyle": "  Aggro  ",
        "tags": ["Goblins", " goblins ", "Tokens", "Goblins", ""],
        "personal_tag": "   League Night   ",
        "notes": long_notes,
    }
    upsert_response = await client.put(
        f"/profiles/{owner_sub}/deck-personalizations/{deck_id}",
        json=payload,
    )
    assert upsert_response.status_code == 200, upsert_response.text
    body = upsert_response.json()
    assert body["deckId"] == deck_id
    assert body["ratings"] == {"stability": 5, "interaction": 1, "resilience": 3}
    assert body["bracket"] == "4"
    assert body["playstyle"] == "Aggro"
    assert body["tags"] == ["Goblins", "Tokens"]
    assert body["personalTag"] == "League Night"
    assert len(body["notes"]) == 2000
    assert body["notes"] == long_notes[:2000]

    fetch_response = await client.get(
        f"/profiles/{owner_sub}/deck-personalizations/{deck_id}",
    )
    assert fetch_response.status_code == 200
    fetched = fetch_response.json()
    assert fetched["ratings"] == body["ratings"]
    assert fetched["personalTag"] == body["personalTag"]
    assert fetched["tags"] == body["tags"]
    assert fetched["notes"] == body["notes"]

    missing_response = await client.get(
        f"/profiles/{owner_sub}/deck-personalizations/unknown-deck",
    )
    assert missing_response.status_code == 404


async def test_linking_guest_player_updates_recorded_games(e2e_context: dict[str, object]) -> None:
    """Linking a guest player retrofits previous games with the user identity."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "link-update-owner"
    friend_sub = "link-update-friend"

    await _upsert_profile(client, owner_sub, display_name="Owner Linker")
    await _upsert_profile(client, friend_sub, display_name="Friend Linker")

    create_player = await client.post(
        f"/profiles/{owner_sub}/players",
        json={"name": "Linkable Guest"},
    )
    assert create_player.status_code == 201
    player_id = create_player.json()["id"]

    playgroup_response = await client.post(
        f"/profiles/{owner_sub}/playgroups",
        json={
            "name": "Link Update Pod",
            "members": [
                {"playerType": "user", "googleSub": owner_sub, "name": "Owner Linker"},
                {"playerType": "guest", "name": "Linkable Guest"},
            ],
        },
    )
    assert playgroup_response.status_code == 201
    playgroup_id = playgroup_response.json()["id"]

    recorded_at = datetime.now(timezone.utc).isoformat()
    record_response = await client.post(
        f"/profiles/{owner_sub}/games",
        json={
            "playgroup": {"id": playgroup_id, "name": "Link Update Pod"},
            "players": [
                {"id": "owner-slot", "name": "Owner Linker", "playerType": "user", "is_owner": True, "googleSub": owner_sub},
                {"id": player_id, "name": "Linkable Guest", "playerType": "guest"},
            ],
            "rankings": [
                {"player_id": "owner-slot", "rank": 1},
                {"player_id": player_id, "rank": 2},
            ],
            "recorded_at": recorded_at,
            "notes": "Initial guest entry.",
        },
    )
    assert record_response.status_code == 201

    games_before = await client.get(f"/profiles/{owner_sub}/games")
    assert games_before.status_code == 200
    games_payload = games_before.json()["games"]
    assert len(games_payload) == 1
    [game_before] = games_payload
    guest_before = next(player for player in game_before["players"] if player["id"] == player_id)
    assert guest_before["playerType"] == "guest"
    assert guest_before.get("googleSub") is None

    link_response = await client.post(
        f"/profiles/{owner_sub}/players/{player_id}/link",
        json={"google_sub": friend_sub},
    )
    assert link_response.status_code == 200

    games_after = await client.get(f"/profiles/{owner_sub}/games")
    assert games_after.status_code == 200
    games_after_payload = games_after.json()["games"]
    assert len(games_after_payload) == 1
    [game_after] = games_after_payload
    guest_after = next(player for player in game_after["players"] if player["id"] == player_id)
    assert guest_after["playerType"] == "user"
    assert guest_after["googleSub"] == friend_sub
    assert guest_after["linkedGoogleSub"] == friend_sub


async def test_public_profile_recent_games_rollup(e2e_context: dict[str, object]) -> None:
    """Public profiles should expose the five most recent games with winners."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "recent-owner"
    rival_sub = "recent-rival"
    owner_name = "Recent Owner"
    rival_name = "Recent Rival"

    await _upsert_profile(client, owner_sub, display_name=owner_name, is_public=True)
    await _upsert_profile(client, rival_sub, display_name=rival_name, is_public=True)

    playgroup_response = await client.post(
        f"/profiles/{owner_sub}/playgroups",
        json={
            "name": "Recency Pod",
            "members": [
                {"playerType": "user", "googleSub": owner_sub, "name": owner_name},
                {"playerType": "user", "googleSub": rival_sub, "name": rival_name},
            ],
        },
    )
    assert playgroup_response.status_code == 201
    playgroup_id = playgroup_response.json()["id"]

    base_time = datetime(2024, 1, 1, tzinfo=timezone.utc)
    timestamp_sequence: list[str] = []
    results_lookup: dict[str, dict[str, str | None]] = {}

    for index in range(6):
        recorded_at = base_time + timedelta(days=index)
        recorded_iso = recorded_at.isoformat().replace("+00:00", "Z")
        timestamp_sequence.append(recorded_iso)
        owner_rank = 1 if index % 2 == 0 else 2
        rival_rank = 1 if owner_rank == 2 else 2
        results_lookup[recorded_iso] = {
            "winner": owner_name if owner_rank == 1 else rival_name,
            "runner_up": rival_name if owner_rank == 1 else owner_name,
        }

        response = await client.post(
            f"/profiles/{owner_sub}/games",
            json={
                "playgroup": {"id": playgroup_id, "name": "Recency Pod"},
                "players": [
                    {
                        "id": f"owner-{index}",
                        "name": owner_name,
                        "playerType": "user",
                        "is_owner": True,
                        "googleSub": owner_sub,
                        "deck_id": "deck-public-001",
                        "deck_name": "Krenko Mayhem",
                    },
                    {
                        "id": f"rival-{index}",
                        "name": rival_name,
                        "playerType": "user",
                        "googleSub": rival_sub,
                    },
                ],
                "rankings": [
                    {"player_id": f"owner-{index}", "rank": owner_rank},
                    {"player_id": f"rival-{index}", "rank": rival_rank},
                ],
                "recorded_at": recorded_iso,
            },
        )
        assert response.status_code == 201

    public_profile = await client.get(f"/social/users/{owner_sub}")
    assert public_profile.status_code == 200
    recent_games = public_profile.json()["recent_games"]
    assert len(recent_games) == 5

    expected_order = list(reversed(timestamp_sequence[1:]))
    actual_order = [entry["created_at"] for entry in recent_games]
    assert actual_order == expected_order

    for entry in recent_games:
        created_at = entry["created_at"]
        assert created_at in results_lookup
        expected = results_lookup[created_at]
        assert entry["winner"] == expected["winner"]
        assert entry["runner_up"] == expected["runner_up"]


async def test_deck_summary_cache_miss_until_sync(e2e_context: dict[str, object]) -> None:
    """Deck summary cache should report misses until sync runs and clear after deletion."""
    client = e2e_context["client"]
    assert isinstance(client, AsyncClient)

    owner_sub = "cache-owner-summary"
    await _upsert_profile(client, owner_sub, moxfield_handle="podcaster")

    cold_summary = await client.get("/cache/users/podcaster/deck-summaries")
    assert cold_summary.status_code == 404

    cold_decks = await client.get("/cache/users/podcaster/decks")
    assert cold_decks.status_code == 404

    summary_sync = await client.get("/users/podcaster/deck-summaries")
    assert summary_sync.status_code == 200
    assert summary_sync.json()["total_decks"] == 1

    cached_summaries = await client.get("/cache/users/podcaster/deck-summaries")
    assert cached_summaries.status_code == 200
    cached_summary_payload = cached_summaries.json()
    assert cached_summary_payload["total_decks"] == 1
    assert cached_summary_payload["decks"][0]["public_id"] == "deck-public-001"

    decks_before_full_sync = await client.get("/cache/users/podcaster/decks")
    assert decks_before_full_sync.status_code == 200
    decks_before_payload = decks_before_full_sync.json()
    assert decks_before_payload["decks"] == []
    assert decks_before_payload["total_decks"] == 1

    decks_sync = await client.get("/users/podcaster/decks")
    assert decks_sync.status_code == 200
    assert decks_sync.json()["total_decks"] == 1

    cached_decks = await client.get("/cache/users/podcaster/decks")
    assert cached_decks.status_code == 200
    cached_decks_payload = cached_decks.json()
    assert cached_decks_payload["decks"][0]["public_id"] == "deck-public-001"

    delete_response = await client.delete("/users/podcaster/decks/deck-public-001")
    assert delete_response.status_code == 204

    summaries_after_delete = await client.get("/cache/users/podcaster/deck-summaries")
    assert summaries_after_delete.status_code == 200
    summaries_after_payload = summaries_after_delete.json()
    assert summaries_after_payload["total_decks"] == 0
    assert summaries_after_payload["decks"] == []

    decks_after_delete = await client.get("/cache/users/podcaster/decks")
    assert decks_after_delete.status_code == 200
    decks_after_payload = decks_after_delete.json()
    assert decks_after_payload["decks"] == []
    assert decks_after_payload["total_decks"] == 0


async def test_moxfield_error_handling() -> None:
    """Upstream Moxfield failures should preserve response semantics."""

    not_found_stub = StubMoxfieldClient(error=MoxfieldNotFoundError("Utilisateur introuvable."))
    async with _stubbed_app_context(not_found_stub) as context:
        client = context["client"]
        assert isinstance(client, AsyncClient)

        decks_response = await client.get("/users/missing-user/decks")
        assert decks_response.status_code == 404

        summaries_response = await client.get("/users/missing-user/deck-summaries")
        assert summaries_response.status_code == 404

    upstream_error_stub = StubMoxfieldClient(error=MoxfieldError("Moxfield indisponible."))
    async with _stubbed_app_context(upstream_error_stub) as context:
        client = context["client"]
        assert isinstance(client, AsyncClient)

        decks_error = await client.get("/users/podcaster/decks")
        assert decks_error.status_code == 502

        summaries_error = await client.get("/users/podcaster/deck-summaries")
        assert summaries_error.status_code == 502
