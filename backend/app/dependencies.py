"""FastAPI dependency providers."""

from functools import lru_cache
from weakref import WeakKeyDictionary

from fastapi import Depends
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .config import get_settings
from .moxfield import MoxfieldClient
from .repositories import MoxfieldCacheRepository


@lru_cache(maxsize=1)
def get_moxfield_client() -> MoxfieldClient:
    """Return a singleton Moxfield client instance."""
    return MoxfieldClient()


@lru_cache(maxsize=1)
def get_mongo_client() -> AsyncIOMotorClient:
    """Return a singleton Motor client."""
    settings = get_settings()
    return AsyncIOMotorClient(settings.mongo_uri)


def get_mongo_database() -> AsyncIOMotorDatabase:
    """Return the configured MongoDB database."""
    settings = get_settings()
    return get_mongo_client()[settings.mongo_db]


_repository_cache: WeakKeyDictionary[
    AsyncIOMotorDatabase, MoxfieldCacheRepository
] = WeakKeyDictionary()


def get_moxfield_cache_repository(
    database: AsyncIOMotorDatabase = Depends(get_mongo_database),
) -> MoxfieldCacheRepository:
    """Return a cached Moxfield cache repository bound to the Mongo database."""
    repository = _repository_cache.get(database)
    if repository is None:
        repository = MoxfieldCacheRepository(database)
        _repository_cache[database] = repository
    return repository


def close_mongo_client() -> None:
    """Close the cached MongoDB client."""
    client = get_mongo_client()
    client.close()
