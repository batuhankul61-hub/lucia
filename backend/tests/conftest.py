import json

import pytest
from fastapi.testclient import TestClient
from google.genai import types

from app.config import Settings, get_settings
from app.deps import get_gemini
from app.main import app
from app.report_schema import ReportUsage
from app.routers import report, token

TURNS = [
    {"role": "tutor", "text": "Hi! What can I get for you today?"},
    {"role": "user", "text": "I want a coffee, please. Yesterday I goed to other cafe."},
    {"role": "tutor", "text": "Sure, what size would you like?"},
    {"role": "user", "text": "Big one with milk."},
]

VALID_REPORT = {
    "grammar_mistakes": [
        {
            "original": "Yesterday I goed to other cafe",
            "corrected": "Yesterday I went to another café.",
            "explanation": "'Go' is irregular: the past tense is 'went'.",
        }
    ],
    "natural_phrasing": [{"original": "Big one with milk", "suggestion": "A large one with milk, please."}],
    "vocabulary": [{"word": "large", "meaning": "big", "example": "A large latte, please."}],
    "fluency_score": 62,
    "accuracy_score": 55,
    "summary": "Good start! Watch irregular past tenses.",
}


class FakeGemini:
    """Stands in for GeminiService; records calls and returns canned data."""

    def __init__(self):
        self.report_json = json.dumps(VALID_REPORT)
        self.fail = False
        self.token_calls = []

    async def create_live_token(self, scenario, level, minutes):
        if self.fail:
            raise RuntimeError("boom")
        self.token_calls.append((scenario.id, level, minutes))
        return types.AuthToken(name="auth_tokens/fake-token", expire_time="2026-11-03T12:00:00Z")

    async def generate_report(self, scenario, level, turns):
        if self.fail:
            raise RuntimeError("boom")
        return self.report_json, ReportUsage(model="fake-model", prompt_tokens=120, output_tokens=80)


@pytest.fixture
def settings():
    return Settings(_env_file=None, gemini_api_key="test-key")


@pytest.fixture
def fake_gemini():
    return FakeGemini()


@pytest.fixture
def client(settings, fake_gemini):
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_gemini] = lambda: fake_gemini
    for limiter in (token.limiter, report.limiter):
        limiter._hits.clear()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
