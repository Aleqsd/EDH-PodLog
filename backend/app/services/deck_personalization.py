"""Business helpers for deck personalization persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..repositories.deck_personalization import DeckPersonalizationRepository
from ..schemas import DeckPersonalization, DeckPersonalizationList, DeckPersonalizationUpdate

LEGACY_DECK_RATING_KEY_MAP = {
    "consistency": "stability",
    "consistance": "stability",
    "consitance": "stability",
    "acceleration": "acceleration",
    "interaction": "interaction",
    "interraction": "interaction",
    "resilience": "resilience",
    "finition": "finish",
    "finish": "finish",
}

DECK_PERSONAL_TAG_LIMIT = 7
PERSONAL_TAG_MAX_LENGTH = 40
PERSONAL_NOTES_MAX_LENGTH = 2000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clamp_rating(value: Any) -> int | None:
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    if numeric < 1:
        return 1
    if numeric > 5:
        return 5
    return numeric


def _sanitize_deck_ratings(raw: Any) -> dict[str, int]:
    if not raw or not isinstance(raw, dict):
        return {}
    sanitized: dict[str, int] = {}
    for key, value in raw.items():
        rating = _clamp_rating(value)
        if rating is None:
            continue
        normalized_key = LEGACY_DECK_RATING_KEY_MAP.get(key, key)
        sanitized[str(normalized_key)] = rating
    return sanitized


def _sanitize_optional_string(value: Any, *, max_length: int | None = None) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if max_length is not None and len(text) > max_length:
        return text[:max_length]
    return text


def _sanitize_bracket_id(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, dict):
        possible = value.get("id") or value.get("value") or value.get("bracket")
        return _sanitize_bracket_id(possible)
    if isinstance(value, (int, float)):
        numeric = int(round(value))
        if 1 <= numeric <= 5:
            return str(numeric)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.isdigit() and len(text) == 1 and "1" <= text <= "5":
            return text
        return text
    return None


def _sanitize_tag_list(tags: Any, limit: int = DECK_PERSONAL_TAG_LIMIT) -> list[str]:
    if not isinstance(tags, list) or limit <= 0:
        return []
    sanitized: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        text = tag.strip() if isinstance(tag, str) else ""
        if not text:
            continue
        fingerprint = text.lower()
        if fingerprint in seen:
            continue
        if len(sanitized) >= limit:
            break
        seen.add(fingerprint)
        sanitized.append(text)
    return sanitized


def _sanitize_personal_tag(value: Any) -> str:
    return _sanitize_optional_string(value, max_length=PERSONAL_TAG_MAX_LENGTH) or ""


def _sanitize_personal_notes(value: Any) -> str:
    return _sanitize_optional_string(value, max_length=PERSONAL_NOTES_MAX_LENGTH) or ""


def _normalize_storage_entry(entry: dict[str, Any] | None) -> dict[str, Any]:
    base: dict[str, Any] = {
        "ratings": {},
        "bracket": None,
        "playstyle": None,
        "tags": [],
        "personal_tag": "",
        "notes": "",
        "version": 2,
        "created_at": None,
        "updated_at": None,
        "google_sub": None,
        "deck_id": None,
    }
    if not entry:
        return base

    normalized = dict(base)
    normalized["google_sub"] = entry.get("google_sub")
    normalized["deck_id"] = entry.get("deck_id")
    normalized["ratings"] = _sanitize_deck_ratings(entry.get("ratings"))
    normalized["bracket"] = _sanitize_bracket_id(
        entry.get("bracket") or entry.get("bracket_id")
    )
    normalized["playstyle"] = _sanitize_optional_string(entry.get("playstyle"))
    normalized["tags"] = _sanitize_tag_list(entry.get("tags"))
    normalized["personal_tag"] = _sanitize_personal_tag(
        entry.get("personal_tag") or entry.get("personalTag")
    )
    normalized["notes"] = _sanitize_personal_notes(entry.get("notes"))
    normalized["version"] = entry.get("version") or 2

    created_at = entry.get("created_at")
    updated_at = entry.get("updated_at")
    if isinstance(created_at, datetime):
        normalized["created_at"] = created_at
    if isinstance(updated_at, datetime):
        normalized["updated_at"] = updated_at

    return normalized


def _apply_personalization_updates(
    existing: dict[str, Any], updates: dict[str, Any]
) -> dict[str, Any]:
    next_entry = dict(existing)
    if "ratings" in updates:
        next_entry["ratings"] = _sanitize_deck_ratings(updates.get("ratings"))
    if "bracket" in updates:
        next_entry["bracket"] = _sanitize_bracket_id(updates.get("bracket"))
    if "playstyle" in updates:
        next_entry["playstyle"] = _sanitize_optional_string(updates.get("playstyle"))
    if "tags" in updates:
        next_entry["tags"] = _sanitize_tag_list(updates.get("tags"))
    if "personal_tag" in updates:
        next_entry["personal_tag"] = _sanitize_personal_tag(updates.get("personal_tag"))
    if "notes" in updates:
        next_entry["notes"] = _sanitize_personal_notes(updates.get("notes"))
    next_entry["version"] = 2
    return next_entry


def _prepare_updates(payload: DeckPersonalizationUpdate) -> dict[str, Any]:
    raw_updates = payload.model_dump(mode="python", exclude_unset=True, by_alias=True)
    normalized: dict[str, Any] = dict(raw_updates)
    if "personalTag" in normalized and "personal_tag" not in normalized:
        normalized["personal_tag"] = normalized.pop("personalTag")
    return normalized


def _build_response_model(document: dict[str, Any]) -> DeckPersonalization:
    normalized = _normalize_storage_entry(document)
    created_at = normalized["created_at"] or _now()
    updated_at = normalized["updated_at"] or created_at
    return DeckPersonalization.model_validate(
        {
            "deck_id": normalized["deck_id"],
            "ratings": normalized["ratings"],
            "bracket": normalized["bracket"],
            "playstyle": normalized["playstyle"],
            "tags": normalized["tags"],
            "personal_tag": normalized["personal_tag"],
            "notes": normalized["notes"],
            "version": normalized["version"],
            "created_at": created_at,
            "updated_at": updated_at,
        }
    )


async def fetch_deck_personalizations(
    database: AsyncIOMotorDatabase, google_sub: str
) -> DeckPersonalizationList:
    repository = DeckPersonalizationRepository(database)
    documents = await repository.list_for_owner(google_sub)
    personalizations: List[DeckPersonalization] = []
    for document in documents:
        # Ensure identifiers are present before validating
        document.setdefault("google_sub", google_sub)
        personalizations.append(_build_response_model(document))
    personalizations.sort(
        key=lambda item: item.updated_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return DeckPersonalizationList(personalizations=personalizations)


async def fetch_deck_personalization(
    database: AsyncIOMotorDatabase, google_sub: str, deck_id: str
) -> DeckPersonalization | None:
    repository = DeckPersonalizationRepository(database)
    document = await repository.find_one(google_sub, deck_id)
    if not document:
        return None
    document.setdefault("google_sub", google_sub)
    document.setdefault("deck_id", deck_id)
    return _build_response_model(document)


async def upsert_deck_personalization(
    database: AsyncIOMotorDatabase,
    google_sub: str,
    deck_id: str,
    payload: DeckPersonalizationUpdate,
) -> DeckPersonalization:
    repository = DeckPersonalizationRepository(database)
    existing = await repository.find_one(google_sub, deck_id)
    normalized_existing = _normalize_storage_entry(existing)
    normalized_existing["google_sub"] = google_sub
    normalized_existing["deck_id"] = deck_id
    if not normalized_existing.get("created_at"):
        normalized_existing["created_at"] = _now()

    updates = _prepare_updates(payload)
    next_entry = _apply_personalization_updates(normalized_existing, updates)
    now = _now()
    next_entry["google_sub"] = google_sub
    next_entry["deck_id"] = deck_id
    next_entry["updated_at"] = now
    next_entry.setdefault("created_at", normalized_existing.get("created_at", now))

    stored = await repository.upsert(next_entry)
    stored.setdefault("google_sub", google_sub)
    stored.setdefault("deck_id", deck_id)
    return _build_response_model(stored)
