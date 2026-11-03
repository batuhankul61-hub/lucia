import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..config import Settings, get_settings
from ..deps import get_gemini, require_access_code
from ..entitlements import current_plan
from ..gemini import GeminiService
from ..ratelimit import RateLimiter, enforce
from ..scenarios import SCENARIOS, Level

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["live"])
limiter = RateLimiter(get_settings().token_rate_limit)


class TokenRequest(BaseModel):
    scenario_id: str
    level: Level = Level.B1


class TokenResponse(BaseModel):
    token: str
    model: str
    expires_at: str
    max_session_minutes: int


@router.post("/token", response_model=TokenResponse, dependencies=[Depends(require_access_code)])
async def create_token(
    body: TokenRequest,
    request: Request,
    gemini: GeminiService = Depends(get_gemini),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    """Give the browser a single-use, short-lived token locked to one scenario."""
    enforce(limiter, request)
    scenario = SCENARIOS.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Unknown scenario.")

    plan = current_plan(request)
    try:
        token = await gemini.create_live_token(scenario, body.level, plan.max_session_minutes)
    except Exception:
        log.exception("Creating a Live token failed")
        raise HTTPException(status_code=502, detail="Could not create a voice session token.")

    return TokenResponse(
        token=token.name or "",
        model=settings.live_model,
        expires_at=token.expire_time or "",
        max_session_minutes=plan.max_session_minutes,
    )
