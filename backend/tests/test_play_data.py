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
