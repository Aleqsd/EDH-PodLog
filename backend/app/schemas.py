"""Pydantic schemas that describe the API responses."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


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


class DeckPersonalization(BaseModel):
    """User-authored personalization for a deck."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    deck_id: str = Field(alias="deckId")
    ratings: Dict[str, int] = Field(default_factory=dict)
    bracket: Optional[str] = None
    playstyle: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    personal_tag: str = Field(default="", alias="personalTag")
    notes: str = ""
    version: int = 2
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class DeckPersonalizationUpdate(BaseModel):
    """Payload accepted when storing a deck personalization."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    ratings: Optional[Dict[str, int]] = None
    bracket: Optional[str] = None
    playstyle: Optional[str] = None
    tags: Optional[List[str]] = None
    personal_tag: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("personal_tag", "personalTag"),
        serialization_alias="personalTag",
    )
    notes: Optional[str] = None


class DeckPersonalizationList(BaseModel):
    """Collection wrapper for personalized decks."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    personalizations: List[DeckPersonalization] = Field(default_factory=list)


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


class PlayerType(str, Enum):
    """Enumeration of player types tracked within the application."""

    USER = "user"
    GUEST = "guest"


class PlayerCreate(BaseModel):
    """Payload used to create a tracked player entry."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)


class PlayerUpdate(BaseModel):
    """Payload accepted when modifying a tracked player."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=160)


class PlayerLinkRequest(BaseModel):
    """Payload accepted when linking a guest player to a real account."""

    model_config = ConfigDict(extra="forbid")

    google_sub: str = Field(min_length=1)


class PlayerSummary(BaseModel):
    """Representation of a tracked player available for playgroup composition."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    player_type: PlayerType = Field(
        validation_alias=AliasChoices("player_type", "playerType"),
        serialization_alias="playerType",
    )
    owner_sub: Optional[str] = None
    google_sub: Optional[str] = None
    linked_google_sub: Optional[str] = None
    decks: List[MoxfieldDeckSelection] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PlayerList(BaseModel):
    """Collection wrapper for tracked players."""

    model_config = ConfigDict(extra="forbid")

    players: List[PlayerSummary] = Field(default_factory=list)


class FollowSummary(BaseModel):
    """Representation of a follow relationship."""

    model_config = ConfigDict(extra="forbid")

    google_sub: str
    display_name: Optional[str] = None
    picture: Optional[str] = None
    followed_at: datetime


class FollowList(BaseModel):
    """Collection wrapper for follow entries."""

    model_config = ConfigDict(extra="forbid")

    following: List[FollowSummary] = Field(default_factory=list)


class FollowRequest(BaseModel):
    """Payload accepted when following a user."""

    model_config = ConfigDict(extra="forbid")

    target_sub: str = Field(min_length=1)


class UserSearchResult(BaseModel):
    """Lightweight profile returned when searching for users."""

    model_config = ConfigDict(extra="forbid")

    google_sub: str
    display_name: Optional[str] = None
    description: Optional[str] = None
    picture: Optional[str] = None
    is_public: bool = False
    is_followed: bool = False


class UserSearchResponse(BaseModel):
    """Collection wrapper for user search results."""

    model_config = ConfigDict(extra="forbid")

    results: List[UserSearchResult] = Field(default_factory=list)


class PublicGameSummary(BaseModel):
    """Condensed representation of a game exposed on public profiles."""

    model_config = ConfigDict(extra="forbid")

    id: str
    playgroup_name: Optional[str] = None
    created_at: datetime
    winner: Optional[str] = None
    runner_up: Optional[str] = None


class PublicUserProfile(BaseModel):
    """Public-facing representation of a user."""

    model_config = ConfigDict(extra="forbid")

    google_sub: str
    display_name: Optional[str] = None
    description: Optional[str] = None
    picture: Optional[str] = None
    followers_count: int = 0
    following_count: int = 0
    moxfield_decks: List[MoxfieldDeckSelection] = Field(default_factory=list)
    recent_games: List[PublicGameSummary] = Field(default_factory=list)


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
    is_public: bool = False
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
    is_public: Optional[bool] = None


class PlaygroupSummary(BaseModel):
    """Summary representation of a saved playgroup."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    last_used_at: Optional[datetime] = None
    game_count: int = 0
    members: List[PlaygroupMember] = Field(default_factory=list)


class PlaygroupCreate(BaseModel):
    """Payload used to create or upsert a playgroup."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    members: Optional[List[PlaygroupMemberUpdate]] = None


class PlaygroupUpdate(BaseModel):
    """Payload accepted when updating playgroup metadata."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    members: Optional[List[PlaygroupMemberUpdate]] = None


class PlaygroupReference(BaseModel):
    """Reference to a playgroup when creating or serialising games."""

    model_config = ConfigDict(extra="forbid")

    id: Optional[str] = None
    name: str


class PlaygroupMember(BaseModel):
    """Member entry associated with a playgroup."""

    model_config = ConfigDict(extra="forbid")

    player_type: PlayerType = Field(
        validation_alias=AliasChoices("player_type", "playerType"),
        serialization_alias="playerType",
    )
    player_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("player_id", "playerId"),
        serialization_alias="playerId",
    )
    google_sub: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("google_sub", "googleSub"),
        serialization_alias="googleSub",
    )
    name: Optional[str] = None
    added_at: Optional[datetime] = Field(
        default=None,
        validation_alias=AliasChoices("added_at", "addedAt"),
        serialization_alias="addedAt",
    )


class PlaygroupMemberUpdate(BaseModel):
    """Payload accepted when mutating playgroup membership."""

    model_config = ConfigDict(extra="forbid")

    player_type: PlayerType = Field(
        validation_alias=AliasChoices("player_type", "playerType"),
        serialization_alias="playerType",
    )
    player_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("player_id", "playerId"),
        serialization_alias="playerId",
    )
    google_sub: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("google_sub", "googleSub"),
        serialization_alias="googleSub",
    )
    name: Optional[str] = None


class GamePlayerInput(BaseModel):
    """Player payload accepted when recording a game."""

    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    id: Optional[str] = None
    name: str
    is_owner: bool = False
    deck_id: Optional[str] = None
    deck_name: Optional[str] = None
    deck_format: Optional[str] = None
    deck_slug: Optional[str] = None
    deck_public_url: Optional[str] = None
    order: Optional[int] = None
    player_type: Optional[PlayerType] = Field(
        default=None,
        validation_alias=AliasChoices("player_type", "playerType"),
        serialization_alias="playerType",
    )
    google_sub: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("google_sub", "googleSub"),
        serialization_alias="googleSub",
    )
    linked_google_sub: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("linked_google_sub", "linkedGoogleSub"),
        serialization_alias="linkedGoogleSub",
    )


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


class PlayerPerformanceSummary(BaseModel):
    """Aggregated statistics for a player within a playgroup."""

    model_config = ConfigDict(extra="forbid")

    player_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("player_id", "playerId"),
        serialization_alias="playerId",
    )
    google_sub: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("google_sub", "googleSub"),
        serialization_alias="googleSub",
    )
    name: Optional[str] = None
    games_played: int = 0
    wins: int = 0
    podiums: int = 0


class DeckPerformanceSummary(BaseModel):
    """Aggregated statistics for cards/decks used in a playgroup."""

    model_config = ConfigDict(extra="forbid")

    deck_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("deck_id", "deckId"),
        serialization_alias="deckId",
    )
    deck_name: Optional[str] = None
    deck_format: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("deck_format", "deckFormat"),
        serialization_alias="deckFormat",
    )
    wins: int = 0
    games_played: int = 0


class PlaygroupStats(BaseModel):
    """Aggregated statistics for a playgroup."""

    model_config = ConfigDict(extra="forbid")

    total_games: int = 0
    player_performance: List[PlayerPerformanceSummary] = Field(default_factory=list)
    deck_performance: List[DeckPerformanceSummary] = Field(default_factory=list)


class PlaygroupDetail(BaseModel):
    """Detailed representation of a playgroup including members and stats."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    last_used_at: Optional[datetime] = None
    game_count: int = 0
    members: List[PlaygroupMember] = Field(default_factory=list)
    stats: PlaygroupStats = Field(default_factory=PlaygroupStats)
    recent_games: List[GameRecord] = Field(default_factory=list)


class PlaygroupList(BaseModel):
    """Collection wrapper returned when listing playgroups."""

    model_config = ConfigDict(extra="forbid")

    playgroups: List[PlaygroupSummary] = Field(default_factory=list)
