"""Pydantic schemas that describe the API responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class Author(BaseModel):
    """Basic information about a Moxfield user."""

    model_config = ConfigDict(extra="forbid")

    user_name: str
    display_name: Optional[str] = None
    profile_image_url: Optional[str] = None


class DeckStats(BaseModel):
    """Aggregate deck statistics."""

    model_config = ConfigDict(extra="forbid")

    like_count: int = 0
    view_count: int = 0
    comment_count: int = 0
    bookmark_count: int = 0


class DeckCard(BaseModel):
    """A single card entry within a board."""

    model_config = ConfigDict(extra="forbid")

    quantity: int
    finish: Optional[str] = None
    is_foil: Optional[bool] = None
    is_alter: Optional[bool] = None
    is_proxy: Optional[bool] = None
    card: Dict[str, Any] = Field(default_factory=dict)


class DeckBoard(BaseModel):
    """A board (mainboard, sideboard, commanders, etc.) within a deck."""

    model_config = ConfigDict(extra="forbid")

    name: str
    count: Optional[int] = None
    cards: List[DeckCard] = Field(default_factory=list)


class DeckTag(BaseModel):
    """Tags assigned by the deck author to individual cards."""

    model_config = ConfigDict(extra="forbid")

    card_name: str
    tags: List[str] = Field(default_factory=list)


class UserSummary(BaseModel):
    """Top-level user descriptor returned by the API."""

    model_config = ConfigDict(extra="forbid")

    user_name: str
    display_name: Optional[str] = None
    profile_image_url: Optional[str] = None
    profile_url: Optional[str] = None
    badges: List[Dict[str, Any]] = Field(default_factory=list)


class DeckSummary(BaseModel):
    """Lightweight deck metadata that excludes card lists."""

    model_config = ConfigDict(extra="forbid")

    id: Optional[str] = None
    public_id: str
    name: str
    format: str
    public_url: Optional[str] = None
    visibility: Optional[str] = None
    description: Optional[str] = ""
    created_at: Optional[datetime] = None
    last_updated_at: Optional[datetime] = None
    stats: DeckStats = Field(default_factory=DeckStats)
    created_by: Optional[Author] = None
    authors: List[Author] = Field(default_factory=list)
    tags: List[DeckTag] = Field(default_factory=list)
    hubs: List[str] = Field(default_factory=list)
    colors: List[str] = Field(default_factory=list)
    color_identity: List[str] = Field(default_factory=list)


class DeckDetail(BaseModel):
    """Full deck details including card breakdown."""

    model_config = ConfigDict(extra="forbid")

    id: Optional[str] = None
    public_id: str
    name: str
    format: str
    public_url: str
    visibility: Optional[str] = None
    description: Optional[str] = ""
    created_at: Optional[datetime] = None
    last_updated_at: Optional[datetime] = None
    stats: DeckStats = Field(default_factory=DeckStats)
    created_by: Optional[Author] = None
    authors: List[Author] = Field(default_factory=list)
    tags: List[DeckTag] = Field(default_factory=list)
    hubs: List[str] = Field(default_factory=list)
    colors: List[str] = Field(default_factory=list)
    color_identity: List[str] = Field(default_factory=list)
    boards: List[DeckBoard] = Field(default_factory=list)
    tokens: List[Dict[str, Any]] = Field(default_factory=list)


class UserDecksResponse(BaseModel):
    """Main response payload for the /users/{username}/decks route."""

    model_config = ConfigDict(extra="forbid")

    user: UserSummary
    total_decks: int
    decks: List[DeckDetail] = Field(default_factory=list)


class UserDeckSummariesResponse(BaseModel):
    """Response for routes returning decks without card details."""

    model_config = ConfigDict(extra="forbid")

    user: UserSummary
    total_decks: int
    decks: List[DeckSummary] = Field(default_factory=list)


class MoxfieldDeckSelection(BaseModel):
    """Deck selection metadata we persist per Google-authenticated user."""

    model_config = ConfigDict(extra="forbid")

    public_id: str
    name: Optional[str] = None
    format: Optional[str] = None
    updated_at: Optional[datetime] = None
    last_synced_at: Optional[datetime] = None
    source: Optional[str] = None
    slug: Optional[str] = None
    url: Optional[str] = None
    card_count: Optional[int] = None


class UserProfile(BaseModel):
    """Representation of a Google-authenticated EDH PodLog user."""

    model_config = ConfigDict(extra="forbid")

    google_sub: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    given_name: Optional[str] = None
    picture: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=1000)
    moxfield_handle: Optional[str] = None
    moxfield_decks: List[MoxfieldDeckSelection] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class UserProfileUpdate(BaseModel):
    """Payload accepted when creating or updating a user profile."""

    model_config = ConfigDict(extra="forbid")

    email: Optional[str] = None
    display_name: Optional[str] = None
    given_name: Optional[str] = None
    picture: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=1000)
    moxfield_handle: Optional[str] = None
    moxfield_decks: Optional[List[MoxfieldDeckSelection]] = None


class PlaygroupSummary(BaseModel):
    """Summary representation of a saved playgroup."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    last_used_at: Optional[datetime] = None
    game_count: int = 0


class PlaygroupCreate(BaseModel):
    """Payload used to create or upsert a playgroup."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)


class PlaygroupReference(BaseModel):
    """Reference to a playgroup when creating or serialising games."""

    model_config = ConfigDict(extra="forbid")

    id: Optional[str] = None
    name: str


class GamePlayerInput(BaseModel):
    """Player payload accepted when recording a game."""

    model_config = ConfigDict(extra="forbid")

    id: Optional[str] = None
    name: str
    is_owner: bool = False
    deck_id: Optional[str] = None
    deck_name: Optional[str] = None
    deck_format: Optional[str] = None
    deck_slug: Optional[str] = None
    deck_public_url: Optional[str] = None
    order: Optional[int] = None


class GamePlayer(GamePlayerInput):
    """Player representation within a stored game."""

    id: str


class GameRankingInput(BaseModel):
    """Ranking payload accepted when recording a game."""

    model_config = ConfigDict(extra="forbid")

    player_id: str
    rank: int = Field(ge=1)


class GameRanking(GameRankingInput):
    """Ranking entry within a stored game."""

    rank: int


class GamePlaygroup(BaseModel):
    """Playgroup metadata embedded in a stored game."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str


class GameCreate(BaseModel):
    """Payload accepted when recording a game result."""

    model_config = ConfigDict(extra="forbid")

    playgroup: PlaygroupReference
    players: List[GamePlayerInput]
    rankings: List[GameRankingInput]
    recorded_at: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


class GameRecord(BaseModel):
    """Stored representation of a game result."""

    model_config = ConfigDict(extra="forbid")

    id: str
    playgroup: GamePlaygroup
    created_at: datetime
    updated_at: datetime
    players: List[GamePlayer]
    rankings: List[GameRanking]
    notes: Optional[str] = None


class GameList(BaseModel):
    """Collection wrapper returned when listing games."""

    model_config = ConfigDict(extra="forbid")

    games: List[GameRecord] = Field(default_factory=list)


class PlaygroupList(BaseModel):
    """Collection wrapper returned when listing playgroups."""

    model_config = ConfigDict(extra="forbid")

    playgroups: List[PlaygroupSummary] = Field(default_factory=list)
