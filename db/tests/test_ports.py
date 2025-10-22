"""Ensure non-standard ports are used across configuration."""

from __future__ import annotations

import re
from pathlib import Path


def test_env_example_uses_custom_mongo_port() -> None:
    content = Path(".env.example").read_text(encoding="utf8")
    assert "mongodb://127.0.0.1:47017" in content


def test_makefile_mongo_port_matches_env() -> None:
    makefile = Path("Makefile").read_text(encoding="utf8")
    match = re.search(r"MONGO_PORT\s*\?=\s*(\d+)", makefile)
    assert match, "MONGO_PORT default not found in Makefile"
    assert match.group(1) == "47017"
