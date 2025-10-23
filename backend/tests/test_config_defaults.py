"""Test configuration defaults for the FastAPI backend."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings  # pylint: disable=wrong-import-position


def test_default_settings_use_custom_mongo_port(monkeypatch) -> None:
    """Ensure defaults avoid the standard MongoDB port."""

    monkeypatch.delenv("MONGO_URI", raising=False)
    monkeypatch.delenv("MONGO_DB_NAME", raising=False)

    settings = Settings.from_env()

    assert settings.mongo_uri.endswith(":47017"), settings.mongo_uri
    assert settings.mongo_db == "edh_podlog"
    assert settings.mongo_users_collection == "users"
    assert settings.mongo_moxfield_users_collection == "moxfield_users"
