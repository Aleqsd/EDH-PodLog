"""Entry point for the Moxfield scraping API server."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .dependencies import close_mongo_client, get_mongo_database
from .logging_utils import get_logger
from .repositories import ensure_moxfield_cache_indexes
from .routers import cache_router, meta_router, profiles_router, users_router

logger = get_logger("backend")


def create_app() -> FastAPI:
    """Instantiate and configure the FastAPI application."""
    app = FastAPI(
        title="Moxfield Scraping API",
        version="0.1.0",
        description="Simple proxy API that fetches public Moxfield data.",
    )

    settings = get_settings()
    allow_origins = list(settings.cors_allow_origins)
    allow_credentials = True
    if not allow_origins:
        allow_origins = ["*"]
        allow_credentials = False
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    async def startup_event() -> None:
        """Prepare database collections (indexes, etc.)."""
        database = get_mongo_database()
        try:
            await ensure_moxfield_cache_indexes(database)
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to ensure Mongo indexes during startup.")

    @app.on_event("shutdown")
    async def shutdown_event() -> None:
        """Ensure connections are closed cleanly."""
        close_mongo_client()

    app.include_router(meta_router)
    app.include_router(profiles_router)
    app.include_router(users_router)
    app.include_router(cache_router)

    return app


app = create_app()
