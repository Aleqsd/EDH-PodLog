"""Tests for the custom logging helpers."""

from __future__ import annotations

import io
import logging

import pytest

from app import logging_utils


def _reset_logger() -> None:
    """Remove handlers between tests to avoid cross-test interference."""
    logger = logging.getLogger(logging_utils.LOGGER_NAME)
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        handler.close()
    logger.setLevel(logging.NOTSET)


@pytest.mark.parametrize(
    "env_value,expected_level",
    [
        ("debug", logging.DEBUG),
        ("INFO", logging.INFO),
        ("WaRnInG", logging.WARNING),
        ("invalid-level", logging.INFO),
        ("", logging.INFO),
    ],
)
def test_configure_logging_respects_env_level(monkeypatch, env_value, expected_level):
    _reset_logger()
    monkeypatch.delenv("EDH_PODLOG_LOG_LEVEL", raising=False)
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    if env_value:
        monkeypatch.setenv("EDH_PODLOG_LOG_LEVEL", env_value)

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    monkeypatch.setattr(logging, "StreamHandler", lambda: handler)

    logger = logging_utils.configure_logging()
    try:
        assert logger.level == expected_level
        for configured_handler in logger.handlers:
            assert configured_handler.level == expected_level

        logger.log(expected_level, "probe message")
        log_line = stream.getvalue().strip()
        assert "probe message" in log_line
    finally:
        _reset_logger()


def test_configure_logging_includes_timestamp(monkeypatch):
    _reset_logger()
    monkeypatch.delenv("EDH_PODLOG_LOG_LEVEL", raising=False)
    monkeypatch.delenv("LOG_LEVEL", raising=False)

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    monkeypatch.setattr(logging, "StreamHandler", lambda: handler)

    logger = logging_utils.configure_logging()
    try:
        logger.info("timestamp check")
        log_line = stream.getvalue().strip()
        assert log_line.startswith("20")  # ISO-like timestamp prefix
        assert "[edh_podlog]" in log_line
        assert "timestamp check" in log_line
    finally:
        _reset_logger()
