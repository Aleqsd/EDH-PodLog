"""Helpers for consistent application logging."""

from __future__ import annotations

import logging
import os
from typing import Final, Optional

LOGGER_NAME: Final[str] = "edh_podlog"
PRIMARY_LEVEL_ENV: Final[str] = "EDH_PODLOG_LOG_LEVEL"
FALLBACK_LEVEL_ENV: Final[str] = "LOG_LEVEL"


def _resolve_log_level() -> int:
    """Return the log level configured via environment variables."""
    raw = os.getenv(PRIMARY_LEVEL_ENV) or os.getenv(FALLBACK_LEVEL_ENV)
    if not raw:
        return logging.INFO

    candidate = raw.strip()
    if not candidate:
        return logging.INFO

    # Support numeric levels and string names (case-insensitive).
    try:
        numeric_level = int(candidate)
    except ValueError:
        normalized = candidate.upper()
        level = getattr(logging, normalized, None)
        if isinstance(level, int):
            return level
    else:
        return numeric_level

    return logging.INFO


def configure_logging() -> logging.Logger:
    """Ensure application logs flow to stdout with sane defaults."""
    logger = logging.getLogger(LOGGER_NAME)
    level = _resolve_log_level()

    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s [%(name)s] %(message)s",
                "%Y-%m-%d %H:%M:%S",
            )
        )
        logger.addHandler(handler)
        logger.propagate = False

    for handler in logger.handlers:
        handler.setLevel(level)

    logger.setLevel(level)
    return logger


def get_logger(child: Optional[str] = None) -> logging.Logger:
    """Return a configured logger, optionally for a named child."""
    base = configure_logging()
    return base.getChild(child) if child else base
