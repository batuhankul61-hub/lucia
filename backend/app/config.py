"""Runtime settings, read from environment variables or backend/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = Field(default="", repr=False)

    # Model IDs checked against https://aistudio.google.com/docs/models (Nov 2026).
    live_model: str = "gemini-3.8-live"
    report_model: str = "gemini-3.5-flash-lite"

    # Comma-separated list of frontend origins allowed by CORS.
    allowed_origins: str = "http://localhost:5500,http://127.0.0.1:5500"

    # Optional shared code. When set, /api/token and /api/report require the
    # X-Access-Code header, so strangers can't spend the free-tier quota.
    access_code: str = Field(default="", repr=False)

    # Requests per client IP per minute.
    token_rate_limit: int = 10
    report_rate_limit: int = 5

    # Behind Render's proxy the client IP is in X-Forwarded-For.
    trust_proxy: bool = False

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
