"""Utilities for resolving the application version shared across services."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def get_application_version() -> str:
    """Return the semantic version string for the application."""
    repo_root = Path(__file__).resolve().parents[2]
    version_file = repo_root / "VERSION"
    try:
        version = version_file.read_text(encoding="utf8").strip()
    except FileNotFoundError:
        return "0.0.0"
    if not version:
        return "0.0.0"
    return version
