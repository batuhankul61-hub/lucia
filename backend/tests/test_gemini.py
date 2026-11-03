"""GeminiService with the SDK client mocked out (no network)."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.genai import errors, types

from app.gemini import GeminiService
from app.report_schema import Turn
from app.scenarios import SCENARIOS, Level

TURNS = [Turn(role="user", text="I goed to the shop yesterday.")]
OK = SimpleNamespace(text="{}", usage_metadata=SimpleNamespace(prompt_token_count=10, candidates_token_count=5))


def high_demand():
    return errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})


@pytest.fixture
def service(settings):
    svc = GeminiService(settings)
    svc._client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=AsyncMock())))
    return svc


def run(svc):
    return asyncio.run(svc.generate_report(SCENARIOS["coffee-shop"], Level.B1, TURNS))


def test_falls_back_when_primary_model_is_overloaded(service):
    service._client.aio.models.generate_content.side_effect = [high_demand(), OK]

    _, usage = run(service)

    calls = service._client.aio.models.generate_content.call_args_list
    assert [c.kwargs["model"] for c in calls] == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    assert usage.model == "gemini-3.1-flash-lite"
    assert (usage.prompt_tokens, usage.output_tokens) == (10, 5)


def test_gives_up_after_last_model(service):
    service._client.aio.models.generate_content.side_effect = [high_demand(), high_demand()]
    with pytest.raises(errors.ServerError):
        run(service)


def test_does_not_retry_client_errors(service):
    bad = errors.ClientError(400, {"error": {"code": 400, "message": "bad", "status": "INVALID_ARGUMENT"}})
    service._client.aio.models.generate_content.side_effect = [bad]
    with pytest.raises(errors.ClientError):
        run(service)
    assert service._client.aio.models.generate_content.call_count == 1


def test_report_request_uses_json_schema(service):
    service._client.aio.models.generate_content.side_effect = [OK]
    run(service)
    config = service._client.aio.models.generate_content.call_args.kwargs["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_schema.__name__ == "Report"


def test_live_token_locks_verbatim_transcription(service):
    create = AsyncMock(return_value=types.AuthToken(name="auth_tokens/x"))
    service._client.aio.auth_tokens = SimpleNamespace(create=create)

    asyncio.run(service.create_live_token(SCENARIOS["job-interview"], Level.B2, 10))

    config = create.call_args.kwargs["config"]
    assert config.uses == 1
    assert config.lock_additional_fields == []
    live = config.live_connect_constraints
    assert live.model == "gemini-3.8-live"
    assert live.config.input_audio_transcription.mode == types.AudioTranscriptionConfigMode.VERBATIM
    assert "hiring manager" in live.config.system_instruction
