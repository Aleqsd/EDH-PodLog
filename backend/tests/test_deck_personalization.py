"""Tests for deck personalization API endpoints."""

from __future__ import annotations


def test_upsert_and_fetch_deck_personalization(api_client):
    user = "user-123"
    deck = "deck-abc"

    response = api_client.put(
        f"/profiles/{user}/deck-personalizations/{deck}",
        json={
            "ratings": {
                "acceleration": 4,
                "finish": 7,
                "interaction": "3",
            },
            "bracket": " 3 ",
            "playstyle": "  Aggro  ",
            "tags": ["Ramp", " Value ", "Ramp", "", "Control"],
            "personalTag": "  Tournoi  ",
            "notes": "  Exemple de notes personnelles.  ",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["deckId"] == deck
    assert payload["ratings"] == {
        "acceleration": 4,
        "finish": 5,
        "interaction": 3,
    }
    assert payload["bracket"] == "3"
    assert payload["playstyle"] == "Aggro"
    assert payload["tags"] == ["Ramp", "Value", "Control"]
    assert payload["personalTag"] == "Tournoi"
    assert payload["notes"] == "Exemple de notes personnelles."
    assert payload["version"] == 2
    assert payload["createdAt"]
    assert payload["updatedAt"]

    # Update only notes and ensure truncation + timestamp changes.
    oversized_notes = "x" * 2500
    second_response = api_client.put(
        f"/profiles/{user}/deck-personalizations/{deck}",
        json={
            "notes": oversized_notes,
        },
    )
    assert second_response.status_code == 200
    updated = second_response.json()
    assert len(updated["notes"]) == 2000
    assert updated["updatedAt"] != payload["updatedAt"]
    # Tags and other fields persist
    assert updated["tags"] == payload["tags"]

    list_response = api_client.get(f"/profiles/{user}/deck-personalizations")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert "personalizations" in listed
    assert len(listed["personalizations"]) == 1
    assert listed["personalizations"][0]["deckId"] == deck

    get_response = api_client.get(f"/profiles/{user}/deck-personalizations/{deck}")
    assert get_response.status_code == 200
    retrieved = get_response.json()
    assert retrieved["deckId"] == deck
    assert retrieved["notes"] == updated["notes"]

    missing_response = api_client.get(
        f"/profiles/{user}/deck-personalizations/deck-missing"
    )
    assert missing_response.status_code == 404
