"""Repository helpers for MongoDB persistence."""

from .deck_personalization import (
    DeckPersonalizationRepository,
    ensure_deck_personalization_indexes,
)
from .moxfield_cache import MoxfieldCacheRepository, ensure_moxfield_cache_indexes
from .play_data import GameRepository, PlaygroupRepository, ensure_play_data_indexes
from .players import PlayerRepository, ensure_player_indexes
from .follows import FollowRepository, ensure_follow_indexes
from .profiles import ensure_user_profile_indexes

__all__ = [
    "MoxfieldCacheRepository",
    "PlaygroupRepository",
    "GameRepository",
    "PlayerRepository",
    "FollowRepository",
    "DeckPersonalizationRepository",
    "ensure_moxfield_cache_indexes",
    "ensure_play_data_indexes",
    "ensure_deck_personalization_indexes",
    "ensure_player_indexes",
    "ensure_follow_indexes",
    "ensure_user_profile_indexes",
]
