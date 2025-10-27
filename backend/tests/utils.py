"""Testing utilities and MongoDB stubs."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, List


class StubCursor:
    """Minimal cursor wrapper to simulate Motor's async cursor."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self._documents = documents

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        if length is None:
            return deepcopy(self._documents)
        return deepcopy(self._documents[:length])


class StubCollection:
    """In-memory Motor-like collection used for API tests."""

    def __init__(self) -> None:
        self.documents: list[dict[str, Any]] = []
        self.created_indexes: list[dict[str, Any]] = []

    def _matches(self, document: dict[str, Any], filter_: dict[str, Any]) -> bool:
        for key, value in filter_.items():
            if key == "$or":
                if not any(self._matches(document, clause) for clause in value):
                    return False
            else:
                if document.get(key) != value:
                    return False
        return True

    async def update_one(
        self,
        filter_: dict[str, Any],
        update: dict[str, Any],
        *,
        upsert: bool = False,
        **_: Any,
    ):
        match = None
        for document in self.documents:
            if self._matches(document, filter_):
                match = document
                break

        matched_count = 0

        if match is not None:
            match.update(deepcopy(update.get("$set", {})))
            matched_count = 1
            return type("UpdateResult", (), {"matched_count": matched_count, "upserted_id": None})()

        if upsert:
            new_document = deepcopy(update.get("$set", {}))
            self.documents.append(new_document)
            return type("UpdateResult", (), {"matched_count": matched_count, "upserted_id": object()})()

        return type("UpdateResult", (), {"matched_count": matched_count, "upserted_id": None})()

    async def replace_one(
        self,
        filter_: dict[str, Any],
        replacement: dict[str, Any],
        *,
        upsert: bool = False,
        **_: Any,
    ):
        for index, document in enumerate(self.documents):
            if self._matches(document, filter_):
                self.documents[index] = deepcopy(replacement)
                return type("ReplaceResult", (), {"matched_count": 1, "upserted_id": None})()
        if upsert:
            self.documents.append(deepcopy(replacement))
            return type("ReplaceResult", (), {"matched_count": 0, "upserted_id": object()})()
        return type("ReplaceResult", (), {"matched_count": 0, "upserted_id": None})()

    async def find_one(self, filter_: dict[str, Any]) -> dict[str, Any] | None:
        for document in self.documents:
            if self._matches(document, filter_):
                return deepcopy(document)
        return None

    def find(self, filter_: dict[str, Any]) -> StubCursor:
        results = [
            deepcopy(document)
            for document in self.documents
            if self._matches(document, filter_)
        ]
        return StubCursor(results)

    async def delete_one(self, filter_: dict[str, Any]):
        for index, document in enumerate(self.documents):
            if self._matches(document, filter_):
                self.documents.pop(index)
                return type("DeleteResult", (), {"deleted_count": 1})()
        return type("DeleteResult", (), {"deleted_count": 0})()

    async def count_documents(self, filter_: dict[str, Any]) -> int:
        return sum(1 for document in self.documents if self._matches(document, filter_))

    async def create_indexes(self, indexes: Iterable[Any]):
        created = []
        for raw in indexes:
            document = getattr(raw, "document", raw)
            name = document.get("name")
            key_spec = document.get("key")
            if isinstance(key_spec, dict):
                keys = tuple(key_spec.items())
            elif isinstance(key_spec, list):
                keys = tuple(tuple(entry) for entry in key_spec)
            else:
                keys = ()
            entry = {"name": name, "keys": keys}
            self.created_indexes.append(entry)
            created.append(name)
        return created


class StubDatabase:
    """Dictionary-like helper that returns stub collections."""

    def __init__(self) -> None:
        self._collections: dict[str, StubCollection] = {}

    def __getitem__(self, name: str) -> StubCollection:
        if name not in self._collections:
            self._collections[name] = StubCollection()
        return self._collections[name]


class StubMoxfieldClient:
    """Simple stub that mimics the Moxfield client behaviour."""

    def __init__(
        self,
        payload: Dict[str, Any] | None = None,
        *,
        error: Exception | None = None,
        summary_payload: Dict[str, Any] | None = None,
        deck_summaries: List[Dict[str, Any]] | None = None,
    ) -> None:
        self._payload = payload
        self._error = error
        self._summary_payload = summary_payload or {}
        self._deck_summaries = list(deck_summaries or [])

    async def collect_user_decks_with_details(self, username: str, **_: Any) -> Dict[str, Any]:
        if self._error:
            raise self._error
        return self._payload or {}

    async def get_user_summary(self, username: str, **_: Any) -> Dict[str, Any]:
        if self._error:
            raise self._error
        if self._summary_payload:
            return self._summary_payload
        return {
            "userName": username,
            "displayName": username,
            "profileImageUrl": None,
            "badges": [],
        }

    async def get_user_deck_summaries(self, username: str, **_: Any) -> List[Dict[str, Any]]:
        if self._error:
            raise self._error
        return self._deck_summaries
