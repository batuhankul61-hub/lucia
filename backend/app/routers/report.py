import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError

from ..config import get_settings
from ..deps import get_gemini, require_access_code
from ..gemini import GeminiService
from ..ratelimit import RateLimiter, enforce
from ..report_schema import Report, ReportRequest, ReportResponse, ground_report
from ..scenarios import SCENARIOS

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["report"])
limiter = RateLimiter(get_settings().report_rate_limit)

MIN_USER_WORDS = 5


@router.post("/report", response_model=ReportResponse, dependencies=[Depends(require_access_code)])
async def create_report(
    body: ReportRequest, request: Request, gemini: GeminiService = Depends(get_gemini)
) -> ReportResponse:
    """Turn a transcript into structured feedback that only cites real learner sentences."""
    enforce(limiter, request)
    scenario = SCENARIOS.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Unknown scenario.")

    user_words = sum(len(t.text.split()) for t in body.turns if t.role == "user")
    if user_words < MIN_USER_WORDS:
        raise HTTPException(status_code=422, detail="Not enough speech to review. Talk a bit more next time.")

    try:
        raw, usage = await gemini.generate_report(scenario, body.level, body.turns)
    except Exception:
        log.exception("Report generation failed")
        raise HTTPException(status_code=502, detail="The report model is unavailable, try again.")

    try:
        report = Report.model_validate_json(raw)
    except ValidationError:
        log.warning("Report did not match the schema: %.500s", raw)
        raise HTTPException(status_code=502, detail="The report model returned an invalid report.")

    grounded, dropped = ground_report(report, body.turns)
    if dropped:
        log.info("Dropped %d ungrounded report items", dropped)
    return ReportResponse(report=grounded, usage=usage, dropped_ungrounded=dropped)
