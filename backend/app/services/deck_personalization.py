"""Business helpers for deck personalization persistence."""

from __future__ import annotations

from dataclasses import dataclass, field
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


@dataclass(slots=True)
class DeckPersonalizationRecord:
    """Structured representation of deck personalization storage entries."""

    google_sub: str | None = None
    deck_id: str | None = None
    ratings: dict[str, int] = field(default_factory=dict)
    bracket: str | None = None
    playstyle: str | None = None
    tags: list[str] = field(default_factory=list)
    personal_tag: str = ""
    notes: str = ""
    version: int = 2
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @staticmethod
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

    @staticmethod
    def _sanitize_optional_string(
        value: Any, *, max_length: int | None = None
    ) -> str | None:
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text:
            return None
        if max_length is not None and len(text) > max_length:
            return text[:max_length]
        return text

    @classmethod
    def _sanitize_deck_ratings(cls, raw: Any) -> dict[str, int]:
        if not raw or not isinstance(raw, dict):
            return {}
        sanitized: dict[str, int] = {}
        for key, value in raw.items():
            rating = cls._clamp_rating(value)
            if rating is None:
                continue
            normalized_key = LEGACY_DECK_RATING_KEY_MAP.get(key, key)
            sanitized[str(normalized_key)] = rating
        return sanitized

    @classmethod
    def _sanitize_bracket_id(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, dict):
            possible = value.get("id") or value.get("value") or value.get("bracket")
            return cls._sanitize_bracket_id(possible)
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

    @classmethod
    def _sanitize_tag_list(cls, tags: Any, limit: int = DECK_PERSONAL_TAG_LIMIT) -> list[str]:
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

    @classmethod
    def _sanitize_personal_tag(cls, value: Any) -> str:
        return cls._sanitize_optional_string(value, max_length=PERSONAL_TAG_MAX_LENGTH) or ""

    @classmethod
    def _sanitize_personal_notes(cls, value: Any) -> str:
        return cls._sanitize_optional_string(value, max_length=PERSONAL_NOTES_MAX_LENGTH) or ""

    @classmethod
    def from_storage(
        cls,
        entry: dict[str, Any] | None,
        *,
        google_sub: str | None = None,
        deck_id: str | None = None,
    ) -> DeckPersonalizationRecord:
        record = cls(google_sub=google_sub, deck_id=deck_id)
        if not entry:
            return record

        record.google_sub = entry.get("google_sub") or record.google_sub
        record.deck_id = entry.get("deck_id") or record.deck_id
        record.ratings = cls._sanitize_deck_ratings(entry.get("ratings"))
        record.bracket = cls._sanitize_bracket_id(
            entry.get("bracket") or entry.get("bracket_id")
        )
        record.playstyle = cls._sanitize_optional_string(entry.get("playstyle"))
        record.tags = cls._sanitize_tag_list(entry.get("tags"))
        record.personal_tag = cls._sanitize_personal_tag(
            entry.get("personal_tag") or entry.get("personalTag")
        )
        record.notes = cls._sanitize_personal_notes(entry.get("notes"))
        record.version = entry.get("version") or 2

        created_at = entry.get("created_at")
        if isinstance(created_at, datetime):
            record.created_at = created_at
        updated_at = entry.get("updated_at")
        if isinstance(updated_at, datetime):
            record.updated_at = updated_at

        return record

    def apply_updates(self, updates: dict[str, Any]) -> DeckPersonalizationRecord:
        if "ratings" in updates:
            self.ratings = self._sanitize_deck_ratings(updates.get("ratings"))
        if "bracket" in updates:
            self.bracket = self._sanitize_bracket_id(updates.get("bracket"))
        if "playstyle" in updates:
            self.playstyle = self._sanitize_optional_string(updates.get("playstyle"))
        if "tags" in updates:
            self.tags = self._sanitize_tag_list(updates.get("tags"))
        if "personal_tag" in updates:
            self.personal_tag = self._sanitize_personal_tag(updates.get("personal_tag"))
        if "notes" in updates:
            self.notes = self._sanitize_personal_notes(updates.get("notes"))
        self.version = 2
        return self

    def to_storage(self) -> dict[str, Any]:
        return {
            "google_sub": self.google_sub,
            "deck_id": self.deck_id,
            "ratings": dict(self.ratings),
            "bracket": self.bracket,
            "playstyle": self.playstyle,
            "tags": list(self.tags),
            "personal_tag": self.personal_tag,
            "notes": self.notes,
            "version": self.version,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _prepare_updates(payload: DeckPersonalizationUpdate) -> dict[str, Any]:
    raw_updates = payload.model_dump(mode="python", exclude_unset=True, by_alias=True)
    normalized: dict[str, Any] = dict(raw_updates)
    if "personalTag" in normalized and "personal_tag" not in normalized:
        normalized["personal_tag"] = normalized.pop("personalTag")
    return normalized


def _build_response_model(record: DeckPersonalizationRecord) -> DeckPersonalization:
    created_at = record.created_at or _now()
    updated_at = record.updated_at or created_at
    return DeckPersonalization.model_validate(
        {
            "deck_id": record.deck_id,
            "ratings": record.ratings,
            "bracket": record.bracket,
            "playstyle": record.playstyle,
            "tags": record.tags,
            "personal_tag": record.personal_tag,
            "notes": record.notes,
            "version": record.version,
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
        record = DeckPersonalizationRecord.from_storage(document, google_sub=google_sub)
        personalizations.append(_build_response_model(record))
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
    record = DeckPersonalizationRecord.from_storage(
        document, google_sub=google_sub, deck_id=deck_id
    )
    return _build_response_model(record)


async def upsert_deck_personalization(
    database: AsyncIOMotorDatabase,
    google_sub: str,
    deck_id: str,
    payload: DeckPersonalizationUpdate,
) -> DeckPersonalization:
    repository = DeckPersonalizationRepository(database)
    existing = await repository.find_one(google_sub, deck_id)
    record = DeckPersonalizationRecord.from_storage(
        existing, google_sub=google_sub, deck_id=deck_id
    )
    if not record.created_at:
        record.created_at = _now()

    updates = _prepare_updates(payload)
    now = _now()
    record.apply_updates(updates)
    record.google_sub = google_sub
    record.deck_id = deck_id
    record.updated_at = now
    record.created_at = record.created_at or now

    stored = await repository.upsert(record.to_storage())
    stored_record = DeckPersonalizationRecord.from_storage(
        stored, google_sub=google_sub, deck_id=deck_id
    )
    return _build_response_model(stored_record)
