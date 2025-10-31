"""Smoke tests for shared version helpers."""

from __future__ import annotations

from pathlib import Path

from app.version import get_application_version


def test_application_version_matches_version_file() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    version_file = repo_root / "VERSION"
    expected = version_file.read_text(encoding="utf8").strip()
    assert expected
    assert get_application_version() == expected
