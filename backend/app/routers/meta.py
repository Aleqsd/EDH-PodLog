"""Meta endpoints (health, diagnostics, etc.)."""

from fastapi import APIRouter

router = APIRouter(tags=["meta"])


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Simple health endpoint for uptime checks."""
    return {"status": "ok"}
