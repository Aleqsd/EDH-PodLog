"""Tests for playgroup and game recording endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_playgroup_and_list(api_client: TestClient) -> None:
    """Playgroups can be created and listed for a user."""
    response = api_client.post(
        "/profiles/user-123/playgroups",
        json={"name": "Mon Groupe"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Mon Groupe"
    assert "id" in body

    list_response = api_client.get("/profiles/user-123/playgroups")
    assert list_response.status_code == 200
    payload = list_response.json()
    assert len(payload["playgroups"]) == 1
    assert payload["playgroups"][0]["name"] == "Mon Groupe"
    assert payload["playgroups"][0]["game_count"] == 0


def test_record_game_updates_history_and_playgroup(api_client: TestClient) -> None:
    """Recording a game should persist players, rankings and touch the playgroup."""
    create_group = api_client.post(
        "/profiles/player-1/playgroups",
        json={"name": "Groupe Test"},
    )
    assert create_group.status_code == 201
    playgroup_id = create_group.json()["id"]

    payload = {
        "playgroup": {"id": playgroup_id, "name": "Groupe Test"},
        "players": [
            {"id": "alice", "name": "Alice", "is_owner": True, "deck_id": "deck-1", "deck_name": "Deck Alpha"},
            {"id": "bob", "name": "Bob"},
            {"id": "charlie", "name": "Charlie"},
            {"id": "dana", "name": "Dana"},
        ],
        "rankings": [
            {"player_id": "alice", "rank": 1},
            {"player_id": "bob", "rank": 2},
            {"player_id": "charlie", "rank": 3},
            {"player_id": "dana", "rank": 4},
        ],
    }

    record_response = api_client.post(
        "/profiles/player-1/games",
        json=payload,
    )
    assert record_response.status_code == 201
    record = record_response.json()
    assert record["playgroup"]["id"] == playgroup_id
    assert record["players"][0]["deck_id"] == "deck-1"
    assert record["rankings"][0]["player_id"] == "alice"

    games_response = api_client.get("/profiles/player-1/games")
    assert games_response.status_code == 200
    games = games_response.json()["games"]
    assert len(games) == 1
    assert games[0]["playgroup"]["id"] == playgroup_id

    playgroups_response = api_client.get("/profiles/player-1/playgroups")
    assert playgroups_response.status_code == 200
    playgroups = playgroups_response.json()["playgroups"]
    assert playgroups[0]["game_count"] == 1
    assert playgroups[0]["last_used_at"] is not None


def test_record_game_creates_playgroup_when_missing(api_client: TestClient) -> None:
    """A new playgroup should be created automatically when only a name is provided."""
    payload = {
        "playgroup": {"name": "Nouveau Groupe"},
        "players": [
            {"id": "p1", "name": "Player One", "is_owner": True},
            {"id": "p2", "name": "Player Two"},
        ],
        "rankings": [
            {"player_id": "p1", "rank": 1},
            {"player_id": "p2", "rank": 2},
        ],
    }

    response = api_client.post("/profiles/owner-42/games", json=payload)
    assert response.status_code == 201
    record = response.json()
    assert record["playgroup"]["name"] == "Nouveau Groupe"
    assert record["playgroup"]["id"]

    groups_response = api_client.get("/profiles/owner-42/playgroups")
    assert groups_response.status_code == 200
    groups = groups_response.json()["playgroups"]
    assert len(groups) == 1
    assert groups[0]["name"] == "Nouveau Groupe"
    assert groups[0]["game_count"] == 1


def test_playgroup_detail_includes_stats_and_members(api_client: TestClient) -> None:
    owner = "stats-owner"
    create_group = api_client.post(
        f"/profiles/{owner}/playgroups",
        json={"name": "Stats Group"},
    )
    assert create_group.status_code == 201
    playgroup_id = create_group.json()["id"]

    game_payload = {
        "playgroup": {"id": playgroup_id, "name": "Stats Group"},
        "players": [
            {"id": "alice", "name": "Alice"},
            {"id": "bob", "name": "Bob"},
            {"id": "carol", "name": "Carol"},
            {"id": "dave", "name": "Dave"},
        ],
        "rankings": [
            {"player_id": "alice", "rank": 1},
            {"player_id": "bob", "rank": 2},
            {"player_id": "carol", "rank": 3},
            {"player_id": "dave", "rank": 4},
        ],
    }
    record_one = api_client.post(f"/profiles/{owner}/games", json=game_payload)
    assert record_one.status_code == 201

    game_payload["rankings"] = [
        {"player_id": "bob", "rank": 1},
        {"player_id": "alice", "rank": 2},
        {"player_id": "carol", "rank": 3},
        {"player_id": "dave", "rank": 4},
    ]
    record_two = api_client.post(f"/profiles/{owner}/games", json=game_payload)
    assert record_two.status_code == 201

    update_members = api_client.put(
        f"/profiles/{owner}/playgroups/{playgroup_id}",
        json={
            "members": [
                {"playerType": "user", "googleSub": "friend-1", "name": "Friend One"},
                {"playerType": "guest", "playerId": "guest-1", "name": "Guest Ally"},
            ]
        },
    )
    assert update_members.status_code == 200

    detail_response = api_client.get(f"/profiles/{owner}/playgroups/{playgroup_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["stats"]["total_games"] == 2
    assert len(detail["members"]) == 2
    wins_by_player = {entry["name"]: entry["wins"] for entry in detail["stats"]["player_performance"]}
    assert wins_by_player["Alice"] == 1
    assert wins_by_player["Bob"] == 1


def test_linking_tracked_player_updates_games(api_client: TestClient) -> None:
    owner = "player-owner"
    target = "linked-user"

    # Ensure owner profile exists for completeness
    owner_profile = api_client.put(
        f"/profiles/{owner}",
        json={"display_name": "Owner Player"},
    )
    assert owner_profile.status_code == 200

    create_player = api_client.post(
        f"/profiles/{owner}/players",
        json={"name": "Guest Player"},
    )
    assert create_player.status_code == 201
    player_id = create_player.json()["id"]

    game_payload = {
        "playgroup": {"name": "Link Group"},
        "players": [
            {"id": player_id, "name": "Guest Player", "deck_id": "deck-guest", "deck_name": "Guest Deck"},
            {"id": "owner-slot", "name": "Owner Player", "is_owner": True},
        ],
        "rankings": [
            {"player_id": player_id, "rank": 1},
            {"player_id": "owner-slot", "rank": 2},
        ],
    }
    record_game = api_client.post(f"/profiles/{owner}/games", json=game_payload)
    assert record_game.status_code == 201

    target_profile = api_client.put(
        f"/profiles/{target}",
        json={
            "display_name": "Linked User",
            "is_public": True,
            "moxfield_decks": [
                {"public_id": "deck-xyz", "name": "Linked Deck", "format": "edh"}
            ],
        },
    )
    assert target_profile.status_code == 200

    link_response = api_client.post(
        f"/profiles/{owner}/players/{player_id}/link",
        json={"google_sub": target},
    )
    assert link_response.status_code == 200
    linked_player = link_response.json()
    assert linked_player["google_sub"] == target
    assert linked_player["playerType"] == "user"

    games_after_link = api_client.get(f"/profiles/{owner}/games")
    assert games_after_link.status_code == 200
    game_body = games_after_link.json()["games"][0]
    updated_guest = next(player for player in game_body["players"] if player["id"] == player_id)
    assert updated_guest["googleSub"] == target
    assert updated_guest["playerType"] == "user"

    available_response = api_client.get(f"/profiles/{owner}/players/available")
    assert available_response.status_code == 200
    available_players = available_response.json()["players"]
    linked_entry = next(player for player in available_players if player["id"] == player_id)
    assert linked_entry["playerType"] == "user"
    assert linked_entry["google_sub"] == target
    assert linked_entry["decks"][0]["public_id"] == "deck-xyz"
