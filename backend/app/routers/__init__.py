"""Feature routers exposed by the FastAPI application."""

from .cache import router as cache_router
from .games import router as games_router
from .meta import router as meta_router
from .playgroups import router as playgroups_router
from .profiles import router as profiles_router
from .users import router as users_router

__all__ = [
    "cache_router",
    "games_router",
    "playgroups_router",
    "meta_router",
    "profiles_router",
    "users_router",
]
