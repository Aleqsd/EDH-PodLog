"""Helpers for consistent application logging."""

from __future__ import annotations

import logging
from typing import Final, Optional

LOGGER_NAME: Final[str] = "edh_podlog"


def configure_logging() -> logging.Logger:
    """Ensure application logs flow to stdout at INFO level or above."""
    logger = logging.getLogger(LOGGER_NAME)
    if logger.handlers:
        return logger

    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    handler.setFormatter(
        logging.Formatter("%(levelname)s [%(name)s] %(message)s")
    )

    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


def get_logger(child: Optional[str] = None) -> logging.Logger:
    """Return a configured logger, optionally for a named child."""
    base = configure_logging()
    return base.getChild(child) if child else base
