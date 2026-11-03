import hmac

from fastapi import Depends, Header, HTTPException

from .config import Settings, get_settings
from .gemini import GeminiService

_service: GeminiService | None = None


def get_gemini(settings: Settings = Depends(get_settings)) -> GeminiService:
    global _service
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Server is missing GEMINI_API_KEY.")
    if _service is None:
        _service = GeminiService(settings)
    return _service


def require_access_code(
    x_access_code: str = Header(default=""), settings: Settings = Depends(get_settings)
) -> None:
    if settings.access_code and not hmac.compare_digest(x_access_code.encode(), settings.access_code.encode()):
        raise HTTPException(status_code=401, detail="Wrong or missing access code.")
