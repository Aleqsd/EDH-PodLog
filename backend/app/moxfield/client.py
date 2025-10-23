"""HTTP client for interacting with the public Moxfield API endpoints."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import anyio
import cloudscraper
from requests import Response

from ..logging_utils import get_logger
from .errors import MoxfieldError, MoxfieldNotFoundError

DEFAULT_BASE_URL = "https://api2.moxfield.com"

logger = get_logger("moxfield.client")


class MoxfieldClient:
    """Minimal client wrapper around the Moxfield API."""

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 15.0,
        scraper: Optional[cloudscraper.CloudScraper] = None,
        max_attempts: int = 3,
        retry_backoff_base: float = 0.75,
        detail_concurrency_limit: int = 4,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_attempts = max(1, max_attempts)
        self.retry_backoff_base = max(0.0, retry_backoff_base)
        self.detail_concurrency_limit = max(1, detail_concurrency_limit)
        self._scraper = scraper or cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "mobile": False}
        )
        # Moxfield is more stable if a referer/user-agent is provided.
        self._scraper.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/118.0.0.0 Safari/537.36"
                ),
                "Referer": "https://www.moxfield.com/",
            }
        )

    # --------------------------------------------------------------------- #
    # Public API methods                                                    #
    # --------------------------------------------------------------------- #

    async def get_user_summary(self, username: str) -> Dict[str, Any]:
        """Lookup a user and return the summary metadata published in search."""
        params = {
            "filter": username,
            "pageNumber": 1,
            "pageSize": 10,
        }
        payload = await self._request_json("GET", "/v2/users/search-sfw", params=params)
        data = payload.get("data", [])
        for entry in data:
            if entry.get("userName", "").lower() == username.lower():
                return entry
        raise MoxfieldNotFoundError(f"Moxfield user '{username}' was not found.")

    async def get_user_deck_summaries(
        self,
        username: str,
        *,
        page_size: int = 100,
        include_pinned: bool = True,
    ) -> List[Dict[str, Any]]:
        """Return all public deck summaries for the given username."""
        page = 1
        decks: List[Dict[str, Any]] = []
        while True:
            params = {
                "authorUserNames": username,
                "pageNumber": page,
                "pageSize": page_size,
                "sortType": "Updated",
                "sortDirection": "Descending",
                "filter": "",
                "fmt": "",
                "includePinned": include_pinned,
                "showIllegal": True,
            }
            payload = await self._request_json("GET", "/v2/decks/search-sfw", params=params)
            data = payload.get("data", [])
            decks.extend(data)
            total_pages = int(payload.get("totalPages", page))
            if page >= total_pages or not data:
                break
            page += 1
        return decks

    async def get_deck_details(self, public_id: str) -> Dict[str, Any]:
        """Fetch full deck details (including board data) by public identifier."""
        return await self._request_json("GET", f"/v3/decks/all/{public_id}")

    async def collect_user_decks_with_details(
        self,
        username: str,
        *,
        page_size: int = 100,
        include_pinned: bool = True,
    ) -> Dict[str, Any]:
        """Gather the summary user data alongside full deck details."""
        started_at = time.perf_counter()
        user_summary = await self.get_user_summary(username)
        deck_summaries = await self.get_user_deck_summaries(
            user_summary["userName"],
            page_size=page_size,
            include_pinned=include_pinned,
        )
        semaphore = anyio.Semaphore(self.detail_concurrency_limit)
        indexed_public_ids: list[tuple[int, str]] = []
        for index, deck in enumerate(deck_summaries):
            public_id = deck.get("publicId")
            if public_id:
                indexed_public_ids.append((index, public_id))

        results: dict[int, Dict[str, Any]] = {}
        lock = anyio.Lock()

        async def _fetch_detail(position: int, public_id: str) -> None:
            async with semaphore:
                detail = await self.get_deck_details(public_id)
            async with lock:
                results[position] = detail

        async with anyio.create_task_group() as task_group:
            for position, public_id in indexed_public_ids:
                task_group.start_soon(_fetch_detail, position, public_id)

        decks = [results[idx] for idx in sorted(results)]
        duration_ms = round((time.perf_counter() - started_at) * 1000.0, 2)
        logger.info(
            "Collected Moxfield deck details.",
            extra={
                "moxfield_user": user_summary.get("userName"),
                "moxfield_deck_count": len(decks),
                "moxfield_detail_concurrency": self.detail_concurrency_limit,
                "moxfield_collect_duration_ms": duration_ms,
            },
        )
        return {
            "user": user_summary,
            "decks": decks,
        }

    # --------------------------------------------------------------------- #
    # Internal helpers                                                      #
    # --------------------------------------------------------------------- #

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        response = await self._request(method, path, params=params)
        try:
            return response.json()
        except ValueError as exc:  # pragma: no cover - defensive
            raise MoxfieldError(
                f"Failed to parse JSON response from '{path}'."
            ) from exc

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        attempts = 0
        last_exception: Exception | None = None
        last_response: Response | None = None

        while attempts < self.max_attempts:
            attempts += 1
            attempt_started = time.perf_counter()
            try:
                response = await anyio.to_thread.run_sync(
                    self._make_request_sync,
                    method,
                    url,
                    params,
                    cancellable=True,
                )
            except Exception as exc:  # pragma: no cover - network failure
                last_exception = exc
                logger.warning(
                    "Moxfield request attempt failed due to exception.",
                    extra={
                        "moxfield_method": method,
                        "moxfield_url": url,
                        "moxfield_attempt": attempts,
                        "moxfield_duration_ms": round(
                            (time.perf_counter() - attempt_started) * 1000.0, 2
                        ),
                        "moxfield_error": str(exc),
                    },
                )
            else:
                duration_ms = round((time.perf_counter() - attempt_started) * 1000.0, 2)
                if response.status_code == 404:
                    logger.info(
                        "Moxfield resource returned 404.",
                        extra={
                            "moxfield_method": method,
                            "moxfield_url": url,
                            "moxfield_duration_ms": duration_ms,
                            "moxfield_attempt": attempts,
                        },
                    )
                    raise MoxfieldNotFoundError(
                        f"Moxfield resource '{url}' returned HTTP 404."
                    )

                if 200 <= response.status_code < 300:
                    logger.info(
                        "Moxfield request succeeded.",
                        extra={
                            "moxfield_method": method,
                            "moxfield_url": url,
                            "moxfield_status": response.status_code,
                            "moxfield_attempt": attempts,
                            "moxfield_duration_ms": duration_ms,
                        },
                    )
                    return response

                last_response = response
                should_retry = response.status_code >= 500 or response.status_code == 429
                log_level = logger.warning if should_retry else logger.error
                log_level(
                    "Moxfield request returned error status.",
                    extra={
                        "moxfield_method": method,
                        "moxfield_url": url,
                        "moxfield_status": response.status_code,
                        "moxfield_attempt": attempts,
                        "moxfield_duration_ms": duration_ms,
                    },
                )
                if not should_retry:
                    raise MoxfieldError(
                        f"Moxfield request to '{url}' failed with "
                        f"status {response.status_code}: {response.text}"
                    )

            if attempts < self.max_attempts:
                backoff = self.retry_backoff_base * (2 ** (attempts - 1))
                if backoff > 0:
                    await anyio.sleep(backoff)

        if last_exception is not None:
            raise MoxfieldError(f"Failed to contact Moxfield: {last_exception}") from last_exception

        if last_response is not None:
            raise MoxfieldError(
                f"Moxfield request to '{url}' failed with "
                f"status {last_response.status_code}: {last_response.text}"
            )

        raise MoxfieldError(f"Moxfield request to '{url}' failed.")

    def _make_request_sync(
        self,
        method: str,
        url: str,
        params: Optional[Dict[str, Any]],
    ) -> Response:
        return self._scraper.request(
            method,
            url,
            params=params,
            timeout=self.timeout,
        )
