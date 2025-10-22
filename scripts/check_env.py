#!/usr/bin/env python3
"""Basic environment sanity checks for EDH PodLog."""

from __future__ import annotations

import os
import sys
from pathlib import Path


ENV_FILENAMES = (".env.local", ".env")
PLACEHOLDER = "REMPLACEZ_MOI_PAR_VOTRE_CLIENT_ID"


def parse_env(content: str) -> dict[str, str]:
    """Parse a dotenv-style string into a dictionary."""
    data: dict[str, str] = {}
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        data[key] = value
    return data


def load_env() -> dict[str, str]:
    """Merge OS environment variables with values from .env files."""
    env: dict[str, str] = dict(os.environ)
    repo_root = Path(__file__).resolve().parent.parent
    for filename in ENV_FILENAMES:
        path = repo_root / filename
        if not path.exists():
            continue
        env.update(parse_env(path.read_text(encoding="utf8")))
    return env


def main() -> int:
    env = load_env()
    issues: list[str] = []

    google_client_id = env.get("GOOGLE_CLIENT_ID", "")
    if not google_client_id or google_client_id == PLACEHOLDER:
        issues.append("GOOGLE_CLIENT_ID is missing or still set to the placeholder.")

    mongo_uri = env.get("MONGO_URI", "")
    if not mongo_uri:
        issues.append("MONGO_URI is missing.")
    elif ":27017" in mongo_uri:
        issues.append(
            "MONGO_URI still targets the default MongoDB port 27017. "
            "Use the repo default 47017 to avoid conflicts."
        )

    api_base = env.get("API_BASE_URL", "")
    if api_base and ":4310" not in api_base:
        # No issue, but ensure a hostname is present
        pass

    if issues:
        print("[check-env] Issues detected:")
        for entry in issues:
            print(f"  - {entry}")
        return 1

    print("[check-env] Environment variables look good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
